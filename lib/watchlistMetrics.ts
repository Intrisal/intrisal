/**
 * Watchlist table metrics from already-stored Supabase rows.
 * Avoids full company snapshots / daily valuation rebuilds on each open.
 */

import { EPS_SPLIT_BASIS_VERSION, type EdgarFundamentals, type QuarterlySeries } from "@/lib/edgar";
import { DAY_MS, isFiscalQuarterGap, trailingGrowth } from "@/lib/fiscalQuarter";
import { displayCompanyName, isKnownFund, normalizeTicker } from "@/lib/market";
import type { CompanySnapshot } from "@/lib/companyData";
import {
  hasStockStore,
  isStoredFund,
  readRecentPriceHistory,
  readStoredQuotes,
  readTickers,
  readValuationReviews,
  type CurrentValuation,
  type ValuationPoint,
} from "@/lib/stockStore";
import { canReviewValuation, prepareValuationReview, resolveValuationDisplay } from "@/lib/valuationReview";
import { sanitizeHistory, stockSignal } from "@/lib/stockSignal";

const EPS_SPLIT_CHECK_EXEMPT_TICKERS = new Set(["ASML", "CCEP", "FER", "NBIS", "PDD"]);
const SUPPORTED_EPS_SPLIT_BASIS_VERSIONS = new Set([EPS_SPLIT_BASIS_VERSION, 4, 5]);
const QUARTERLY_FILING_BACKFILLS = new Set(["TSM", "CP", "ENB", "PDD", "RY", "TD", "BMO", "BNS", "CM"]);

function canUseDilutedEps(ticker: string, edgar: EdgarFundamentals | null | undefined) {
  const version = edgar?.epsSplitBasisVersion;
  return (version !== undefined && SUPPORTED_EPS_SPLIT_BASIS_VERSIONS.has(version))
    || (EPS_SPLIT_CHECK_EXEMPT_TICKERS.has(ticker) && Boolean(edgar?.dilutedEps.values.length));
}

function rollingTtm(series: QuarterlySeries, requireConsecutive = false): QuarterlySeries {
  const ends: string[] = [];
  const values: number[] = [];
  for (let i = 0; i < series.values.length; i++) {
    const end = series.ends[i];
    const endMs = Date.parse(end);
    if (!Number.isFinite(endMs)) continue;

    if (i >= 3) {
      const consecutive = series.ends.slice(i - 3, i + 1);
      const consecutiveOk = consecutive.slice(1).every((date, index) => {
        const gap = (Date.parse(date) - Date.parse(consecutive[index]!)) / DAY_MS;
        return isFiscalQuarterGap(gap);
      });
      if (consecutiveOk) {
        ends.push(end);
        values.push(series.values.slice(i - 3, i + 1).reduce((total, value) => total + value, 0));
        continue;
      }
    }

    if (requireConsecutive) continue;
    const picked: number[] = [];
    let oldestMs = endMs;
    for (let j = i; j >= 0 && picked.length < 4; j--) {
      const pointMs = Date.parse(series.ends[j]!);
      if (!Number.isFinite(pointMs)) continue;
      const age = endMs - pointMs;
      if (age > 420 * DAY_MS) break;
      picked.push(series.values[j]!);
      oldestMs = pointMs;
    }
    const span = endMs - oldestMs;
    if (picked.length === 4 && span >= 250 * DAY_MS && span <= 420 * DAY_MS) {
      ends.push(end);
      values.push(picked.reduce((total, value) => total + value, 0));
    }
  }
  return { ends: ends.slice(-68), values: values.slice(-68) };
}

function inferIsFinancial(edgar: EdgarFundamentals) {
  const recent = Object.values(edgar.balances).slice(-8);
  let stiHeavy = 0;
  for (const balance of recent) {
    if (balance.sti != null && balance.cash != null && balance.sti > Math.max(balance.cash, 1) * 5) stiHeavy += 1;
  }
  return stiHeavy >= 4;
}

function emptyWatchSnapshot(
  ticker: string,
  name: string,
  isFund: boolean,
  price: number | null,
  change: number | null,
  priceAsOf?: string,
): CompanySnapshot {
  return {
    ticker,
    name,
    isFund,
    price,
    change,
    priceAsOf,
    peTtm: null,
    evNopat: null,
    evNopatAvg: null,
    latestDailyValuation: null,
    signal: null,
    revenueHistory: [],
    operatingIncomeHistory: [],
    epsHistory: [],
    fcfHistory: [],
    filingDates: { revenue: [], operatingIncome: [], eps: [], fcf: [] },
    evNopatHistory: [],
    revBillions: null,
    growthYoY: null,
    epsTtm: null,
    fcfBillions: null,
    opincBillions: null,
    de: null,
    marketCapBillions: null,
    dividendYieldPercent: null,
    sources: { prices: price == null ? "unavailable" : "marketstack", fundamentals: "unavailable" },
  };
}

function valuationFields(
  ticker: string,
  edgar: EdgarFundamentals,
  points: ValuationPoint[],
  current: CurrentValuation | null,
  price: number | null,
) {
  const valuationReview = process.env.INTRISAL_VALUATION_VERSION !== "legacy" && canReviewValuation(ticker, edgar);
  if (!valuationReview || (edgar.reportingCurrency ?? "USD") !== "USD") {
    return {
      valuationReview: false,
      valuationHidden: true,
      valuationHasNegativeOperatingIncome: false,
      valuationAverageYears: undefined as 5 | 10 | undefined,
      evNopatAvg: null as number | null,
      latestDailyValuation: null as { date: string; multiple: number } | null,
      evNopat: null as number | null,
    };
  }

  const financialQuarters = prepareValuationReview(ticker, edgar, null).financialQuarters();
  const hasNegativeOperatingIncome = financialQuarters.some(({ negativeOperatingIncome }) => negativeOperatingIncome);
  const isFinancial = Boolean(edgar.isFinancial) || inferIsFinancial(edgar);
  const latestBalance = edgar.balances[edgar.operatingIncome.ends.at(-1) ?? ""] ?? null;
  const latestEnterpriseValue =
    price != null && latestBalance?.shares != null && latestBalance.cash != null
      ? price * latestBalance.shares
        + (latestBalance.debt ?? 0)
        - latestBalance.cash
        - (latestBalance.sti ?? 0)
      : null;
  const display = resolveValuationDisplay({
    points,
    financialQuarters,
    isFinancial,
    latestEnterpriseValue,
    hasNegativeOperatingIncome,
  });
  const displayPoints = display.show ? display.points : [];
  const hideValuation = !display.show && !hasNegativeOperatingIncome;
  const latestDailyValuation = !hideValuation && current && current.ev_nopat > 0 && current.priceAsOf
    ? { date: current.priceAsOf, multiple: current.ev_nopat }
    : null;

  return {
    valuationReview: true,
    valuationHidden: hideValuation,
    valuationHasNegativeOperatingIncome: hasNegativeOperatingIncome,
    valuationAverageYears: display.averageYears ?? undefined,
    evNopatAvg: displayPoints.length > 0
      ? displayPoints.reduce((total, { ev_nopat }) => total + ev_nopat, 0) / displayPoints.length
      : null,
    latestDailyValuation,
    evNopat: latestDailyValuation?.multiple ?? null,
  };
}

/** Load only the fields the Watchlist table needs, from stored tickers / reviews / prices. */
export async function loadWatchlistSnapshots(symbols: string[]): Promise<Record<string, CompanySnapshot>> {
  const tickers = [...new Set(symbols.map(normalizeTicker).filter(Boolean))];
  if (!tickers.length || !hasStockStore()) return {};

  const [storedRows, reviews, quotes] = await Promise.all([
    readTickers(tickers),
    readValuationReviews(tickers).catch(() => ({})),
    readStoredQuotes(tickers).catch(() => ({ quotes: {}, names: {} as Record<string, string> })),
  ]);
  const byTicker = new Map(storedRows.map((row) => [row.ticker, row]));

  const snapshots = await Promise.all(tickers.map(async (ticker) => {
    const stored = byTicker.get(ticker);
    const quote = quotes.quotes[ticker] ?? null;
    const price = quote?.price ?? null;
    const change = quote?.change ?? null;
    const priceAsOf = quote?.date;
    const isFund = isKnownFund(ticker) || isStoredFund(stored);
    const name = displayCompanyName(ticker, quotes.names[ticker] ?? stored?.name);
    const edgar = !isFund ? stored?.edgar_snapshot ?? null : null;

    if (!edgar) {
      const base = emptyWatchSnapshot(ticker, name, isFund, price, change, priceAsOf);
      // Funds and filing-less names still get an SMA signal from stored prices.
      const history = await readRecentPriceHistory(ticker, 252).catch(() => null);
      const signal = stockSignal(null, history ? sanitizeHistory(history) : null);
      return [ticker, { ...base, signal }] as const;
    }

    const requireConsecutive = QUARTERLY_FILING_BACKFILLS.has(ticker);
    const revenue = rollingTtm(edgar.revenue, requireConsecutive);
    const epsSeries = canUseDilutedEps(ticker, edgar) ? edgar.dilutedEps : null;
    const asmlEpsIsTtm = ticker === "ASML" && edgar.source === "edgar-6k";
    const eps = epsSeries
      ? (asmlEpsIsTtm
        ? { ends: epsSeries.ends.slice(-68), values: epsSeries.values.slice(-68) }
        : rollingTtm(epsSeries, requireConsecutive))
      : { ends: [] as string[], values: [] as number[] };

    const review = reviews[ticker] ?? { points: [], current: null };
    const valuation = valuationFields(ticker, edgar, review.points, review.current, price);
    const revenueGrowth = trailingGrowth(revenue.values, revenue.ends);
    const history = await readRecentPriceHistory(ticker, 252).catch(() => null);
    const signal = stockSignal(revenueGrowth, history ? sanitizeHistory(history) : null);

    const snapshot: CompanySnapshot = {
      ...emptyWatchSnapshot(ticker, name, false, price, change, priceAsOf),
      sources: { prices: price == null ? "unavailable" : "marketstack", fundamentals: "edgar" },
      revenueHistory: revenue.values,
      epsHistory: eps.values,
      filingDates: {
        revenue: revenue.ends,
        operatingIncome: [],
        eps: eps.ends,
        fcf: [],
      },
      signal,
      ...valuation,
    };
    return [ticker, snapshot] as const;
  }));

  return Object.fromEntries(snapshots);
}
