/**
 * Merge Marketstack EOD prices with EDGAR fundamentals into one snapshot
 * for Graph Analysis / Fundamental / Valuation.
 */

import { estimateNextEarningsDate, fetchEdgarFundamentals, type EdgarFundamentals, type QuarterlySeries } from "@/lib/edgar";
import { sample, type Sample } from "@/lib/market";
import { fetchStockHistory } from "@/lib/marketstack";

export type CompanySnapshot = {
  ticker: string;
  price: number;
  change: number;
  /** Trailing P/E when from filings; may stand in for UI "Fwd P/E" with a footnote */
  peTtm: number | null;
  evNopat: number | null;
  /** 10Y-ish average EV/NOPAT from quarterly history when available */
  evNopatAvg: number | null;
  revBillions: number | null;
  growthYoY: number | null;
  epsTtm: number | null;
  fcfBillions: number | null;
  opincBillions: number | null;
  de: string | null;
  marketCapBillions: number | null;
  nextEarningsDate: string | null;
  nextEarningsEstimated: boolean;
  dividendYieldPercent: number | null;
  revenueHistory: number[];
  operatingIncomeHistory: number[];
  epsHistory: number[];
  fcfHistory: number[];
  /** Quarterly EV/NOPAT series for valuation chart */
  evNopatHistory: number[];
  sources: {
    prices: "marketstack" | "sample";
    fundamentals: "edgar" | "sample";
  };
};

/** Sum quarters whose period end falls within ~1 year of the latest end. */
function ttm(series: QuarterlySeries): number | null {
  if (!series.values.length) return null;
  const n = Math.min(series.values.length, series.ends.length);
  if (n < 4) {
    return series.values.slice(0, n).reduce((a, b) => a + b, 0) * (4 / n);
  }
  const latestEnd = series.ends[n - 1];
  const latestMs = Date.parse(latestEnd + "T00:00:00Z");
  if (!Number.isFinite(latestMs)) {
    return series.values.slice(-4).reduce((a, b) => a + b, 0);
  }
  const windowMs = 400 * 86400000; // ~4 quarters with slack for fiscal calendars
  let sum = 0;
  let count = 0;
  for (let i = n - 1; i >= 0 && count < 4; i--) {
    const endMs = Date.parse(series.ends[i] + "T00:00:00Z");
    if (!Number.isFinite(endMs) || latestMs - endMs > windowMs) break;
    sum += series.values[i];
    count += 1;
  }
  if (count < 4) {
    // Fall back to last four reported quarters if fiscal gaps skipped frames.
    return series.values.slice(-4).reduce((a, b) => a + b, 0);
  }
  return sum;
}

function yoyGrowth(series: QuarterlySeries): number | null {
  const now = ttm(series);
  if (now == null || series.values.length < 8 || series.ends.length < 8) return null;
  const n = Math.min(series.values.length, series.ends.length);
  const latestMs = Date.parse(series.ends[n - 1] + "T00:00:00Z");
  if (!Number.isFinite(latestMs)) return null;
  // Prior TTM: quarters ending ~1y earlier (365–765 days before latest).
  let prior = 0;
  let count = 0;
  for (let i = n - 1; i >= 0 && count < 4; i--) {
    const endMs = Date.parse(series.ends[i] + "T00:00:00Z");
    if (!Number.isFinite(endMs)) continue;
    const age = latestMs - endMs;
    if (age < 350 * 86400000) continue;
    if (age > 780 * 86400000) break;
    prior += series.values[i];
    count += 1;
  }
  if (count < 4 || !prior) {
    prior = series.values.slice(-8, -4).reduce((a, b) => a + b, 0);
  }
  if (!prior) return null;
  return ((now / prior) - 1) * 100;
}

/** Rolling four-quarter TTM for flow metrics (revenue, opinc, FCF, EPS). */
function rollingTtm(series: QuarterlySeries, maxPoints = 61): number[] {
  const out: number[] = [];
  for (let i = 3; i < series.values.length; i++) {
    out.push(series.values.slice(i - 3, i + 1).reduce((a, b) => a + b, 0));
  }
  return out.slice(-maxPoints);
}

function nopatFromOpinc(opincBillions: number, taxRate = 0.21) {
  return opincBillions * (1 - taxRate);
}

async function safePrice(ticker: string): Promise<{ price: number; change: number; source: "marketstack" | "sample" }> {
  try {
    const history = await fetchStockHistory(ticker);
    return { price: history.price, change: history.change, source: "marketstack" };
  } catch {
    const s = sample(ticker);
    return { price: s.price, change: s.change, source: "sample" };
  }
}

function fromSample(ticker: string, price: number, change: number, priceSource: "marketstack" | "sample"): CompanySnapshot {
  const s = sample(ticker);
  return {
    ticker: ticker.toUpperCase(),
    price,
    change,
    peTtm: s.fpe,
    evNopat: s.evn,
    evNopatAvg: s.avg,
    revBillions: s.rev,
    growthYoY: s.growth,
    epsTtm: s.eps,
    fcfBillions: s.fcf,
    opincBillions: s.opinc,
    de: s.de,
    marketCapBillions: s.marketCapBillions,
    nextEarningsDate: s.nextEarningsDate,
    nextEarningsEstimated: false,
    dividendYieldPercent: s.dividendYieldPercent,
    revenueHistory: [],
    operatingIncomeHistory: [],
    epsHistory: [],
    fcfHistory: [],
    evNopatHistory: [],
    sources: { prices: priceSource, fundamentals: "sample" },
  };
}

function buildFromEdgar(
  ticker: string,
  edgar: EdgarFundamentals,
  price: number,
  change: number,
  priceSource: "marketstack" | "sample",
): CompanySnapshot {
  const revTtm = ttm(edgar.revenue);
  const opTtm = ttm(edgar.operatingIncome);
  const epsTtm = ttm(edgar.dilutedEps);
  const fcfTtm = ttm(edgar.freeCashFlow);
  const growthYoY = yoyGrowth(edgar.revenue);

  const marketCapBillions =
    edgar.sharesOutstandingBillions != null ? price * edgar.sharesOutstandingBillions : null;

  const nopat = opTtm != null ? nopatFromOpinc(opTtm) : null;
  const enterpriseValue =
    marketCapBillions != null
      ? marketCapBillions + (edgar.debtBillions ?? 0) - (edgar.cashBillions ?? 0)
      : null;
  const evNopat = enterpriseValue != null && nopat && nopat > 0 ? enterpriseValue / nopat : null;

  // Rough quarterly EV/NOPAT using trailing 4Q NOPAT + *current* EV (no historical prices).
  // Drop early tiny-NOPAT outliers so the average isn't dominated by ancient periods.
  const op = edgar.operatingIncome.values;
  const evNopatHistory: number[] = [];
  if (enterpriseValue != null && op.length >= 4) {
    const windows: number[] = [];
    for (let i = 3; i < op.length; i++) {
      windows.push(nopatFromOpinc(op.slice(i - 3, i + 1).reduce((a, b) => a + b, 0)));
    }
    const latestNopat = windows[windows.length - 1] || 0;
    const floor = Math.max(0.05, latestNopat * 0.08);
    for (const n of windows) {
      if (n < floor) continue;
      evNopatHistory.push(enterpriseValue / n);
    }
  }

  const peTtm = epsTtm && epsTtm !== 0 ? price / epsTtm : null;
  const dividendYieldPercent =
    edgar.dividendPerShare != null && price > 0 ? (edgar.dividendPerShare / price) * 100 : 0;

  const next = estimateNextEarningsDate(edgar.lastReportEnd);

  return {
    ticker: ticker.toUpperCase(),
    price,
    change,
    peTtm,
    evNopat,
    evNopatAvg:
      evNopatHistory.length > 0
        ? evNopatHistory.reduce((a, b) => a + b, 0) / evNopatHistory.length
        : evNopat,
    revBillions: revTtm,
    growthYoY,
    epsTtm,
    fcfBillions: fcfTtm,
    opincBillions: opTtm,
    de:
      edgar.debtBillions != null && edgar.equityBillions && edgar.equityBillions > 0
        ? (edgar.debtBillions / edgar.equityBillions).toFixed(2)
        : edgar.debtBillions != null && marketCapBillions && marketCapBillions > 0
          ? (edgar.debtBillions / marketCapBillions).toFixed(2)
          : null,
    marketCapBillions,
    nextEarningsDate: next,
    nextEarningsEstimated: Boolean(next),
    dividendYieldPercent,
    revenueHistory: rollingTtm(edgar.revenue),
    operatingIncomeHistory: rollingTtm(edgar.operatingIncome),
    epsHistory: rollingTtm(edgar.dilutedEps),
    fcfHistory: rollingTtm(edgar.freeCashFlow),
    evNopatHistory: evNopatHistory.slice(-40),
    sources: { prices: priceSource, fundamentals: "edgar" },
  };
}

/** Sample-shaped object for older UI helpers that still call into Sample fields. */
export function snapshotToSample(snap: CompanySnapshot): Sample {
  const fallback = sample(snap.ticker);
  return {
    price: snap.price,
    change: snap.change,
    fpe: snap.peTtm ?? fallback.fpe,
    evn: snap.evNopat ?? fallback.evn,
    avg: snap.evNopatAvg ?? fallback.avg,
    rev: snap.revBillions ?? fallback.rev,
    growth: snap.growthYoY ?? fallback.growth,
    eps: snap.epsTtm ?? fallback.eps,
    fcf: snap.fcfBillions ?? fallback.fcf,
    opinc: snap.opincBillions ?? fallback.opinc,
    de: snap.de ?? fallback.de,
    marketCapBillions: snap.marketCapBillions,
    nextEarningsDate: snap.nextEarningsDate,
    dividendYieldPercent: snap.dividendYieldPercent ?? fallback.dividendYieldPercent,
  };
}

export async function getCompanySnapshot(ticker: string): Promise<CompanySnapshot> {
  const id = ticker.trim().toUpperCase();
  const { price, change, source: priceSource } = await safePrice(id);

  try {
    const edgar = await fetchEdgarFundamentals(id);
    if (!edgar) {
      return fromSample(id, price, change, priceSource);
    }
    if (edgar.revenue.values.length >= 4) {
      return buildFromEdgar(id, edgar, price, change, priceSource);
    }

    // Partial coverage (e.g. foreign issuers with annual 20-F only, no quarterly XBRL):
    // still apply shares outstanding so market cap is not the sample placeholder.
    const snap = fromSample(id, price, change, priceSource);
    if (edgar.sharesOutstandingBillions != null && edgar.sharesOutstandingBillions > 0) {
      snap.marketCapBillions = price * edgar.sharesOutstandingBillions;
    }
    if (edgar.debtBillions != null && edgar.equityBillions && edgar.equityBillions > 0) {
      snap.de = (edgar.debtBillions / edgar.equityBillions).toFixed(2);
    }
    if (edgar.dividendPerShare != null && price > 0) {
      snap.dividendYieldPercent = (edgar.dividendPerShare / price) * 100;
    }
    return snap;
  } catch {
    return fromSample(id, price, change, priceSource);
  }
}
