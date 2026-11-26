/**
 * Merge Marketstack EOD prices with EDGAR fundamentals into one snapshot
 * for Graph Analysis / Fundamental / Valuation.
 */

import { fetchEdgarFundamentals, latestFinancialFiling, resolveCik, type EdgarFundamentals, type QuarterlySeries } from "@/lib/edgar";
import { isKnownFund, sample, type Sample } from "@/lib/market";
import { calculateValuations, hasStockStore, markFilingsChecked, readPrices, readStoredQuotes, readTicker, readValuations, saveFundamentals, saveValuations, type ValuationPoint } from "@/lib/stockStore";

export type CompanySnapshot = {
  ticker: string;
  price: number;
  change: number;
  priceAsOf?: string;
  isFund?: boolean;
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
    priceSource === "marketstack" && edgar.sharesOutstandingBillions != null ? price * edgar.sharesOutstandingBillions : null;

  const nopat = opTtm != null ? nopatFromOpinc(opTtm) : null;
  const enterpriseValue =
    marketCapBillions != null
      ? marketCapBillions + (edgar.debtBillions ?? 0) - (edgar.cashBillions ?? 0)
      : null;
  const evNopat = enterpriseValue != null && nopat && nopat > 0 ? enterpriseValue / nopat : null;

  const evNopatHistory = valuationPoints.map((point) => point.ev_nopat);

  const peTtm = priceSource === "marketstack" && epsTtm ? price / epsTtm : null;
  const dividendPerShare = edgar.dividendPerShare ?? 0;
  const dividendYieldPercent = dividendPerShare === 0
    ? 0
    : priceSource === "marketstack" && price > 0 ? (dividendPerShare / price) * 100 : null;

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
    dividendYieldPercent: snap.dividendYieldPercent ?? fallback.dividendYieldPercent,
  };
}

const pending = new Map<string, Promise<CompanySnapshot>>();

async function loadSnapshot(id: string, isFund: boolean): Promise<CompanySnapshot> {
  const configured = hasStockStore();
  const [stored, quote] = configured ? await Promise.all([
    readTicker(id).catch((error) => {
      console.error("Could not read stock cache", error);
      return undefined;
    }),
    readStoredQuotes([id]).then((quotes) => quotes[id] ?? null).catch(() => null),
  ]) : [undefined, null];

  let edgar = isFund ? null : stored?.edgar_snapshot ?? null;
  let valuations: ValuationPoint[] = [];
  if (!edgar && !isFund) {
    try {
      const fetched = await fetchEdgarFundamentals(id);
      if (fetched && fetched.revenue.values.length >= 4) {
        edgar = fetched;
        const history = quote ? await readPrices(id).catch(() => null) : null;
        valuations = calculateValuations(fetched, history);
        if (configured) {
          await saveValuations(id, valuations);
          await saveFundamentals(id, fetched);
        }
      }
    } catch (error) {
      console.error("EDGAR backfill failed for " + id, error);
    }
  } else if (edgar) {
    valuations = await readValuations(id).catch(() => []);
  }

  const priceSource = quote ? "marketstack" : "sample";
  const fallback = sample(id);
  const price = quote?.price ?? fallback.price;
  const change = quote?.change ?? fallback.change;
  const snapshot = edgar
    ? buildFromEdgar(id, edgar, price, change, priceSource, valuations)
    : fromSample(id, price, change, priceSource);
  return { ...snapshot, isFund, priceAsOf: quote?.date };
}

export function getCompanySnapshot(ticker: string, isFund = isKnownFund(ticker)) {
  const id = ticker.trim().toUpperCase();
  const key = isFund ? "fund:" + id : id;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = loadSnapshot(id, isFund).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export async function refreshCompanyFilings(ticker: string) {
  const stored = await readTicker(ticker);
  const previous = stored?.edgar_snapshot;
  const cik = previous?.cik ?? await resolveCik(ticker);
  const accession = cik ? await latestFinancialFiling(cik) : undefined;
  if (!cik || !accession || accession === previous?.filingAccession) {
    await markFilingsChecked(ticker);
    return previous ? "unchanged" : "unavailable";
  }
  const filing = await fetchEdgarFundamentals(ticker, true, { cik, accession });
  if (!filing || filing.revenue.values.length < 4) {
    await markFilingsChecked(ticker);
    return "unavailable";
  }
  const history = await readPrices(ticker);
  await saveValuations(ticker, calculateValuations(filing, history));
  await saveFundamentals(ticker, filing);
  return "updated";
}
