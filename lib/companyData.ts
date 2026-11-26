/**
 * Merge Marketstack EOD prices with EDGAR fundamentals into one snapshot
 * for Graph Analysis / Fundamental / Valuation.
 */

import { readFile } from "node:fs/promises";
import { EPS_SPLIT_BASIS_VERSION, fetchEdgarFundamentals, latestFinancialFiling, resolveCik, type EdgarFundamentals, type QuarterlySeries, type ReportingCurrency } from "@/lib/edgar";
import { isKnownFund } from "@/lib/market";
import { calculateValuations, hasStockStore, markFilingsChecked, readPrices, readStoredQuotes, readTicker, readValuationReview, readValuations, saveFundamentals, saveValuationReview, saveValuations, type CurrentValuation, type ValuationPoint } from "@/lib/stockStore";
import { canReviewValuation, prepareValuationReview, valuationBenchmark } from "@/lib/valuationReview";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";

const EPS_SPLIT_CHECK_EXEMPT_TICKERS = new Set(["ASML", "CCEP", "FER", "NBIS", "PDD"]);

type ValuationUnavailable = { kind: "nonpositive-nopat" | "missing-data"; detail: string };
const missingValuationInputs: Record<string, string> = {
  "missing cash": "Cash balance unavailable.",
  "missing debt": "Debt data unavailable.",
  "missing usable shares": "Share count unavailable.",
  "missing short-term investments": "Short-term investment data unavailable.",
  "fewer than four operating quarters": "Four operating quarters are needed.",
  "nonconsecutive operating quarters": "Operating results are missing for a quarter in this 12-month period.",
};

function valuationUnavailable(reason: string | undefined, fallback: string): ValuationUnavailable {
  return reason === "nonpositive NOPAT"
    ? { kind: "nonpositive-nopat", detail: "Trailing 12-month NOPAT is zero or negative." }
    : { kind: "missing-data", detail: (reason && missingValuationInputs[reason]) || fallback };
}

export type CompanySnapshot = {
  ticker: string;
  price: number | null;
  change: number | null;
  priceAsOf?: string;
  reportingCurrency?: ReportingCurrency;
  isFund?: boolean;
  /** Trailing P/E when from filings; may stand in for UI "Fwd P/E" with a footnote */
  peTtm: number | null;
  evNopat: number | null;
  /** Average of available quarterly multiples in the ten years ending at the latest valuation quarter. */
  evNopatAvg: number | null;
  evNopatAverageQuarters?: number;
  valuationReview?: boolean;
  valuationHasNegativeOperatingIncome?: boolean;
  valuationPriceAsOf?: string;
  valuationEarningsRelease?: boolean;
  valuationDebtEstimate?: ValuationPoint["debtEstimate"];
  currentValuationUnavailable?: ValuationUnavailable;
  unavailableValuationQuarters?: (ValuationUnavailable & { quarter: string })[];
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
    prices: "marketstack" | "unavailable";
    fundamentals: "edgar" | "unavailable";
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

/** Keep each TTM total and its filing period together, skipping gaps in the source. */
function rollingTtm(series: QuarterlySeries): QuarterlySeries {
  const ends: string[] = [];
  const values: number[] = [];
  for (let i = 3; i < series.values.length; i++) {
    const quarters = series.ends.slice(i - 3, i + 1);
    if (quarters.slice(1).some((end, index) => {
      const gap = (Date.parse(end) - Date.parse(quarters[index])) / DAY_MS;
      return !isFiscalQuarterGap(gap);
    })) continue;
    ends.push(series.ends[i]);
    values.push(series.values.slice(i - 3, i + 1).reduce((a, b) => a + b, 0));
  }
  return { ends: ends.slice(-61), values: values.slice(-61) };
}

function nopatFromOpinc(opincBillions: number, taxRate = 0.21) {
  return opincBillions * (1 - taxRate);
}

function withoutFilings(ticker: string, price: number | null, change: number | null, priceSource: CompanySnapshot["sources"]["prices"]): CompanySnapshot {
  return {
    ticker: ticker.toUpperCase(),
    price,
    change,
    peTtm: null,
    evNopat: null,
    evNopatAvg: null,
    currentValuationUnavailable: valuationUnavailable(undefined, "Reported financials unavailable."),
    revBillions: null,
    growthYoY: null,
    epsTtm: null,
    fcfBillions: null,
    opincBillions: null,
    de: null,
    marketCapBillions: null,
    dividendYieldPercent: null,
    revenueHistory: [],
    operatingIncomeHistory: [],
    epsHistory: [],
    fcfHistory: [],
    evNopatHistory: [],
    sources: { prices: priceSource, fundamentals: "unavailable" },
  };
}

function buildFromEdgar(
  ticker: string,
  edgar: EdgarFundamentals,
  price: number | null,
  change: number | null,
  priceSource: CompanySnapshot["sources"]["prices"],
  valuationPoints: ValuationPoint[],
  valuationReview: boolean,
  currentValuation: CurrentValuation | null,
): CompanySnapshot {
  const revTtm = ttm(edgar.revenue);
  const opTtm = ttm(edgar.operatingIncome);
  const eps = canUseDilutedEps(ticker, edgar) ? edgar.dilutedEps : null;
  const asmlEpsIsTtm = ticker === "ASML" && edgar.source === "edgar-6k";
  const revenueHistory = rollingTtm(edgar.revenue);
  const operatingHistory = rollingTtm(edgar.operatingIncome);
  let epsHistory: QuarterlySeries = { ends: [], values: [] };
  if (eps) {
    // The existing ASML 6-K backfill stores a trailing 12-month figure at each quarter end.
    epsHistory = asmlEpsIsTtm
      ? { ends: eps.ends.slice(-61), values: eps.values.slice(-61) }
      : rollingTtm(eps);
  }
  const cashFlowHistory = rollingTtm(edgar.freeCashFlow);
  const epsTtm = epsHistory.values.at(-1) ?? null;
  const reportingCurrency = edgar.reportingCurrency ?? "USD";
  const compatiblePriceCurrency = priceSource === "marketstack" && reportingCurrency === "USD";
  const fcfTtm = ttm(edgar.freeCashFlow);
  const growthYoY = yoyGrowth(edgar.revenue);

  const marketCapBillions =
    price != null && edgar.sharesOutstandingBillions != null ? price * edgar.sharesOutstandingBillions : null;

  const nopat = opTtm != null ? nopatFromOpinc(opTtm) : null;
  const financialQuarters = valuationReview ? prepareValuationReview(ticker, edgar, null).financialQuarters() : [];
  const latestFinancialReason = financialQuarters.at(-1)?.reason;
  const enterpriseValue =
    compatiblePriceCurrency && marketCapBillions != null && edgar.debtBillions != null && edgar.cashBillions != null
      ? marketCapBillions + edgar.debtBillions - edgar.cashBillions
      : null;
  const evNopat = valuationReview
    ? latestFinancialReason === "nonpositive NOPAT" ? null : currentValuation?.ev_nopat ?? null
    : process.env.INTRISAL_VALUATION_VERSION === "legacy" && enterpriseValue != null && nopat && nopat > 0
      ? enterpriseValue / nopat : null;

  if (reportingCurrency !== "USD") valuationPoints = [];
  const evNopatHistory = valuationPoints.map((point) => point.ev_nopat);
  // Exclude the matching quarter ten years earlier, giving 40 points when coverage is complete.
  const benchmark = valuationBenchmark(valuationPoints);
  const plottedQuarters = new Set(valuationPoints.map(({ quarter }) => quarter));
  const unavailableValuationQuarters = financialQuarters.filter(({ quarter }) => !plottedQuarters.has(quarter))
    .map(({ quarter, reason }) => ({ quarter, ...valuationUnavailable(reason, "Valuation data unavailable for this quarter.") }));
  const currentValuationUnavailable = evNopat == null ? valuationUnavailable(latestFinancialReason,
    price == null ? "Closing price unavailable." : "Valuation data unavailable.") : undefined;

  const peTtm = compatiblePriceCurrency && price != null && (!asmlEpsIsTtm || edgar.reportingCurrency === "USD") && epsTtm
    ? price / epsTtm
    : null;
  const dividendPerShare = edgar.dividendPerShare;
  const dividendYieldPercent = dividendPerShare === 0
    ? 0
    : compatiblePriceCurrency && price != null && price > 0 && dividendPerShare != null ? (dividendPerShare / price) * 100 : null;

  return {
    ticker: ticker.toUpperCase(),
    reportingCurrency,
    price,
    change,
    peTtm,
    evNopat,
    evNopatAvg: benchmark.length > 0
      ? benchmark.reduce((total, { ev_nopat }) => total + ev_nopat, 0) / benchmark.length
      : null,
    evNopatAverageQuarters: benchmark.length,
    valuationReview,
    valuationHasNegativeOperatingIncome: financialQuarters.some(({ negativeOperatingIncome }) => negativeOperatingIncome),
    valuationPriceAsOf: evNopat == null ? undefined : currentValuation?.priceAsOf,
    valuationEarningsRelease: evNopat == null ? undefined : currentValuation?.earningsRelease,
    valuationDebtEstimate: evNopat == null ? undefined : currentValuation?.debtEstimate,
    currentValuationUnavailable,
    unavailableValuationQuarters,
    revBillions: revTtm,
    growthYoY,
    epsTtm,
    fcfBillions: fcfTtm,
    opincBillions: opTtm,
    de:
      edgar.debtBillions != null && edgar.equityBillions && edgar.equityBillions > 0
        ? (edgar.debtBillions / edgar.equityBillions).toFixed(2)
        : null,
    marketCapBillions,
    dividendYieldPercent,
    revenueHistory: revenueHistory.values,
    operatingIncomeHistory: operatingHistory.values,
    epsHistory: epsHistory.values,
    fcfHistory: cashFlowHistory.values,
    filingDates: {
      revenue: revenueHistory.ends,
      operatingIncome: operatingHistory.ends,
      eps: epsHistory.ends,
      fcf: cashFlowHistory.ends,
    },
    evNopatHistory,
    valuationPoints,
    sources: { prices: priceSource, fundamentals: "edgar" },
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

  const useStage = process.env.NODE_ENV === "development" && process.env.INTRISAL_VALUATION_STAGE === "1";
  const stage = useStage ? (JSON.parse(await readFile(".cache/valuation-stage.json", "utf8")) as Record<string, {
    snapshot?: EdgarFundamentals; points?: ValuationPoint[]; current?: CurrentValuation | null;
  }>)[id] : undefined;
  let edgar = isFund ? null : stage?.snapshot ?? stored?.edgar_snapshot ?? null;
  let refreshedValuation: Awaited<ReturnType<typeof saveValuationReview>> | undefined;
  if (!useStage && !isFund && !edgar && !EPS_SPLIT_CHECK_EXEMPT_TICKERS.has(id)) {
    try {
      const fetched = await fetchEdgarFundamentals(id);
      if (fetched && fetched.revenue.values.length >= 4) {
        edgar = configured ? await saveFundamentals(id, fetched) : fetched;
        if (configured && quote) refreshedValuation = await refreshStoredValuations(id, edgar);
      }
    } catch (error) {
      console.error("EDGAR backfill failed for " + id, error);
    }
  }

  const valuationReview = process.env.INTRISAL_VALUATION_VERSION !== "legacy" && canReviewValuation(id, edgar);
  const revised = valuationReview
    ? useStage ? { points: stage?.points ?? [], current: stage?.current ?? null }
      : refreshedValuation ?? await readValuationReview(id).catch(() => null)
    : null;
  const valuations = valuationReview ? revised?.points ?? []
    : edgar && process.env.INTRISAL_VALUATION_VERSION === "legacy" ? await readValuations(id).catch(() => []) : [];
  const priceSource = quote ? "marketstack" : "unavailable";
  const price = quote?.price ?? null;
  const change = quote?.change ?? null;
  const snapshot = edgar
    ? buildFromEdgar(id, edgar, price, change, priceSource, valuations, valuationReview, revised?.current ?? null)
    : withoutFilings(id, price, change, priceSource);
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

function canUseDilutedEps(ticker: string, edgar: EdgarFundamentals | null | undefined) {
  return edgar?.epsSplitBasisVersion === EPS_SPLIT_BASIS_VERSION
    || (EPS_SPLIT_CHECK_EXEMPT_TICKERS.has(ticker) && Boolean(edgar?.dilutedEps.values.length));
}

export async function refreshStoredValuations(ticker: string, edgar: EdgarFundamentals) {
  const history = await readPrices(ticker);
  if (process.env.INTRISAL_VALUATION_VERSION === "legacy") {
    await saveValuations(ticker, calculateValuations(edgar, history));
  }
  return saveValuationReview(ticker, edgar, history);
}

export async function refreshCompanyFilings(ticker: string) {
  const stored = await readTicker(ticker);
  const previous = stored?.edgar_snapshot;
  if (ticker === "TEST" || EPS_SPLIT_CHECK_EXEMPT_TICKERS.has(ticker) || previous?.source === "edgar-6k") {
    if (stored) await markFilingsChecked(ticker);
    return "excluded";
  }
  const cik = previous?.cik ?? stored?.cik ?? await resolveCik(ticker);
  const accession = cik ? await latestFinancialFiling(cik) : undefined;
  if (!cik || !accession || (
    accession === previous?.filingAccession && canUseDilutedEps(ticker, previous)
  )) {
    if (previous && accession && canReviewValuation(ticker, previous)) {
      const revised = await readValuationReview(ticker);
      const quarter = previous.operatingIncome.ends.at(-1);
      if (quarter && revised.current?.quarter !== quarter) await refreshStoredValuations(ticker, previous);
    }
    await markFilingsChecked(ticker);
    return previous ? "unchanged" : "unavailable";
  }
  const filing = await fetchEdgarFundamentals(ticker, true, { cik, accession });
  if (!filing || filing.revenue.values.length < 4) {
    await markFilingsChecked(ticker);
    return "unavailable";
  }
  const merged = await saveFundamentals(ticker, filing);
  await refreshStoredValuations(ticker, merged);
  return "updated";
}
