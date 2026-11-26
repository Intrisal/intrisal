/**
 * Merge Marketstack EOD prices with EDGAR fundamentals into one snapshot
 * for Graph Analysis / Fundamental / Valuation.
 */

import { estimateNextEarningsDate, fetchEdgarFundamentals, type EdgarFundamentals, type QuarterlySeries } from "@/lib/edgar";
import { sample, type Sample } from "@/lib/market";
import { fetchStockHistory } from "@/lib/marketstack";
import { calculateValuations, hasStockStore, readPrices, readTicker, readValuations, saveFundamentals, savePrices, saveValuations, type ValuationPoint } from "@/lib/stockStore";

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
  filingDates?: { revenue: string[]; operatingIncome: string[]; eps: string[]; fcf: string[] };
  /** Quarterly EV/NOPAT series for valuation chart */
  evNopatHistory: number[];
  valuationPoints?: ValuationPoint[];
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
  valuationPoints: ValuationPoint[],
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

  const evNopatHistory = valuationPoints.map((point) => point.ev_nopat);

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
    filingDates: {
      revenue: edgar.revenue.ends.slice(3).slice(-61),
      operatingIncome: edgar.operatingIncome.ends.slice(3).slice(-61),
      eps: edgar.dilutedEps.ends.slice(3).slice(-61),
      fcf: edgar.freeCashFlow.ends.slice(3).slice(-61),
    },
    evNopatHistory,
    valuationPoints,
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

const pending = new Map<string, Promise<CompanySnapshot>>();

const fresh = (at: string | null | undefined) =>
  Boolean(at && Date.now() - Date.parse(at) < 23 * 60 * 60 * 1000);

async function loadSnapshot(id: string, refreshEdgar: boolean): Promise<CompanySnapshot> {
  const configured = hasStockStore();
  const stored = configured ? await readTicker(id).catch((error) => {
    console.error("Could not read stock cache", error);
    return undefined;
  }) : undefined;
  let history = stored ? await readPrices(id).catch(() => null) : null;
  let priceChanged = false;
  if (!refreshEdgar && (!history || !fresh(stored?.prices_fetched_at))) {
    const fetched = await fetchStockHistory(id, true).catch(() => null);
    if (fetched) {
      history = fetched;
      priceChanged = true;
      if (configured) await savePrices(id, fetched).catch((error) => console.error("Could not save prices", error));
    }
  }

  let edgar = stored?.edgar_snapshot ?? null;
  let fundamentalsChanged = false;
  if (refreshEdgar || !edgar) {
    try {
      const fetched = await fetchEdgarFundamentals(id, refreshEdgar);
      if (fetched && fetched.revenue.values.length >= 4) {
        edgar = fetched;
        fundamentalsChanged = true;
        if (configured) await saveFundamentals(id, fetched);
      }
    } catch (error) {
      console.error("EDGAR refresh failed for " + id, error);
      if (refreshEdgar) throw error;
    }
  }

  const priceSource = history ? "marketstack" : "sample";
  const fallback = sample(id);
  if (!edgar) return fromSample(id, history?.price ?? fallback.price, history?.change ?? fallback.change, priceSource);

  const points = calculateValuations(edgar, history);
  let valuations = points;
  if (configured && (priceChanged || fundamentalsChanged)) {
    await saveValuations(id, points).catch((error) => {
      if (refreshEdgar) throw error;
      console.error("Could not save valuations", error);
    });
  }
  if (configured && (!priceChanged && !fundamentalsChanged || points.length < 2)) {
    const cached = await readValuations(id).catch(() => []);
    if (cached.length > points.length) valuations = cached;
  }
  return buildFromEdgar(id, edgar, history?.price ?? fallback.price, history?.change ?? fallback.change, priceSource, valuations);
}

export function getCompanySnapshot(ticker: string) {
  const id = ticker.trim().toUpperCase();
  const existing = pending.get(id);
  if (existing) return existing;
  const request = loadSnapshot(id, false).finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}

export async function refreshCompanyFilings(ticker: string) {
  return (await loadSnapshot(ticker, true)).sources.fundamentals === "edgar";
}
