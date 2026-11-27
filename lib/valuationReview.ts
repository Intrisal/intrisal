import type { EdgarFundamentals, QuarterlySeries } from "@/lib/edgar";
import type { StockHistory } from "@/lib/marketstack";
import type { ValuationPoint } from "@/lib/stockStore";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";

const REVIEW_EXCLUDED = new Set(["ASML", "CCEP", "FER", "NBIS", "PDD", "TEST"]);
const SPLIT_RATIOS = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 15, 16, 20, 25, 30, 40, 50, 100];
// Meta first issued senior notes in August 2022. Reported pre-issue balances
// still take precedence over the zero assumption.
const META_FIRST_BOND_MONTH = "2022-08-01";
const MAX_DAILY_FINANCIAL_AGE = 185 * DAY_MS;
export type DailyValuation = { date: string; filed: string; point: ValuationPoint | null };

function priceSplits(history: StockHistory) {
  const splits: { date: string; factor: number }[] = [];
  for (let i = 1; i < history.dates.length; i++) {
    const rawBefore = history.rawCloses?.[i - 1];
    const rawAfter = history.rawCloses?.[i];
    const adjustedBefore = history.closes[i - 1];
    const adjustedAfter = history.closes[i];
    if (!rawBefore || !rawAfter || !adjustedBefore || !adjustedAfter) continue;
    const adjustedMove = adjustedAfter / adjustedBefore;
    if (adjustedMove < 0.75 || adjustedMove > 1.33) continue;
    const factor = rawBefore / rawAfter * adjustedMove;
    const magnitude = Math.max(factor, 1 / factor);
    const split = SPLIT_RATIOS.find((ratio) => Math.abs(magnitude / ratio - 1) < 0.02);
    if (split) splits.push({ date: history.dates[i], factor: factor >= 1 ? split : 1 / split });
  }
  return splits;
}

/** Match potentially restated share counts to the raw closing price's split basis. */
function sharesOnPriceBasis(edgar: EdgarFundamentals, history: StockHistory) {
  const splits = priceSplits(history);
  const shares = new Map<string, number>();
  let reference: { date: string; shares: number } | undefined;
  for (const date of [...edgar.operatingIncome.ends].reverse()) {
    const balance = edgar.balances[date];
    const reported = balance?.reportedShares ?? balance?.shares;
    if (reported == null || reported <= 0) continue;
    const futureSplits = splits.filter((split) => split.date > date);
    let normalized = reported;
    if (futureSplits.length) {
      // After the last observed split there is only one possible basis. Work backwards
      // from that anchor and only use earlier bases supported by nearby share counts.
      if (!reference || Date.parse(reference.date) - Date.parse(date) > 370 * DAY_MS) continue;
      const ratioToReference = futureSplits.filter((split) => split.date <= reference!.date)
        .reduce((product, split) => product * split.factor, 1);
      const expected = reference.shares / ratioToReference;
      let candidate = reported;
      for (const split of futureSplits) {
        candidate /= split.factor;
        if (Math.abs(Math.log(candidate / expected)) < Math.abs(Math.log(normalized / expected))) normalized = candidate;
      }
      if (Math.abs(Math.log(normalized / expected)) > Math.log(1.35)) continue;
    }
    shares.set(date, normalized);
    reference = { date, shares: normalized };
  }
  return {
    shares,
    factorAfter: (date: string) => splits.filter((split) => split.date > date)
      .reduce((product, split) => product * split.factor, 1),
  };
}

export function canReviewValuation(ticker: string, edgar: EdgarFundamentals | null) {
  return Boolean(edgar && edgar.source !== "edgar-6k" && !REVIEW_EXCLUDED.has(ticker));
}

function valuesByDate(series: QuarterlySeries) {
  return new Map(series.ends.map((date, index) => [date, series.values[index]]));
}

export function prepareValuationReview(ticker: string, edgar: EdgarFundamentals, history: StockHistory | null) {
  const { ends, values } = edgar.operatingIncome;
  const tax = valuesByDate(edgar.tax);
  const pretax = valuesByDate(edgar.pretax);
  const basis = history ? sharesOnPriceBasis(edgar, history) : null;
  const reportedDebt = Object.keys(edgar.balances).sort().flatMap((date) => {
    const debt = edgar.balances[date]?.debt;
    return debt != null && Number.isFinite(debt) && debt >= 0 ? [{ date, debt }] : [];
  });

  const eligible = canReviewValuation(ticker, edgar) && (edgar.reportingCurrency ?? "USD") === "USD";
  const benchmarkQuarters = valuationBenchmark(ends.map((quarter, index) => ({ quarter, index }))).slice(-40);

  function fundamentalsAt(index: number) {
    const quarter = ends[index];
    if (!eligible) return { reason: "ineligible filing or currency" } as const;
    if (index < 3) return { reason: "fewer than four operating quarters" } as const;
    const window = ends.slice(index - 3, index + 1);
    if (window.slice(1).some((date, i) => !isFiscalQuarterGap((Date.parse(date) - Date.parse(window[i])) / DAY_MS))) {
      return { reason: "nonconsecutive operating quarters" } as const;
    }
    const sum = (metric: Map<string, number>) => {
      const data = window.map((date) => metric.get(date));
      return data.reduce<number | null>((total, value) => total != null && value != null && Number.isFinite(value)
        ? total + value : null, 0);
    };
    const taxSum = sum(tax);
    const pretaxSum = sum(pretax);
    const rate = taxSum != null && pretaxSum != null && pretaxSum > 0
      ? Math.min(0.35, Math.max(0, taxSum / pretaxSum)) : 0.21;
    const operatingIncome = values.slice(index - 3, index + 1);
    if (operatingIncome.length !== 4 || !operatingIncome.every(Number.isFinite)) {
      return { reason: "invalid NOPAT data" } as const;
    }
    const trailingIncome = operatingIncome.reduce((total, value) => total + value, 0);
    const nopat = trailingIncome * (1 - rate);
    if (!Number.isFinite(nopat)) return { reason: "invalid NOPAT data" } as const;
    if (nopat <= 0) return { reason: "nonpositive NOPAT", negativeOperatingIncome: trailingIncome < 0 } as const;

    const balance = edgar.balances[quarter];
    if (balance?.cash == null) return { reason: "missing cash" } as const;
    const reported = balance.debt != null && Number.isFinite(balance.debt) && balance.debt >= 0
      ? balance.debt : null;
    const assumeZero =
      (ticker === "META" && quarter < META_FIRST_BOND_MONTH) ||
      reportedDebt.length === 0;
    const priorDebt = reported == null && !assumeZero ? reportedDebt.findLast(({ date }) => date < quarter) : undefined;
    const debt = reported ?? (assumeZero ? 0 : priorDebt?.debt);
    if (debt == null) return { reason: "missing debt" } as const;
    const reportedShares = balance.reportedShares ?? balance.shares;
    if (reportedShares == null || !Number.isFinite(reportedShares) || reportedShares <= 0) {
      return { reason: "missing usable shares" } as const;
    }
    const estimatedShares = balance.reportedShares == null && balance.sharesEstimated === true;
    const debtEstimate = reported == null
      ? priorDebt ? { debt, method: "carried-forward" as const, reportedAsOf: priorDebt.date }
        : { debt, method: "assumed-zero" as const }
      : undefined;
    return { inputs: { nopat, rate, debt, cash: balance.cash, sti: balance.sti ?? 0, estimatedShares, debtEstimate } } as const;
  }

  function asOf(index: number, close: number | undefined | null, shares: number | undefined, result = fundamentalsAt(index)) {
    if (!result.inputs) return { reason: result.reason } as const;
    if (close == null || !Number.isFinite(close) || close <= 0) return { reason: "missing usable closing price" } as const;
    if (shares == null) return { reason: "missing usable shares" } as const;
    const { nopat, rate, debt, cash, sti, estimatedShares, debtEstimate } = result.inputs;
    const ev = close * shares + debt - cash - sti;
    if (!Number.isFinite(ev) || ev <= 0) return { reason: "nonpositive or invalid EV" } as const;
    return {
      point: { quarter: ends[index], close, ev, nopat, ev_nopat: ev / nopat, ...(estimatedShares ? { sharesEstimated: true } : {}), ...(debtEstimate ? { debtEstimate } : {}) },
      rate, estimatedShares,
    } as const;
  }

  function quarterlyResults() {
    return benchmarkQuarters.map(({ quarter, index }) => {
      const priceIndex = history?.dates.findLastIndex((date) => date <= quarter) ?? -1;
      const close = history && priceIndex >= 0 && Date.parse(quarter) - Date.parse(history.dates[priceIndex]) <= 7 * DAY_MS
        ? history.rawCloses?.[priceIndex] : null;
      return { quarter, ...asOf(index, close, basis?.shares.get(quarter)) };
    });
  }

  return {
    // Missing-price quarters are derived by the caller from the stored point series.
    // Filing-related reasons are available without reading price history.
    financialQuarters() {
      if (!eligible) return [];
      return benchmarkQuarters.map(({ quarter, index }) => {
        const { reason, negativeOperatingIncome } = fundamentalsAt(index);
        return { quarter, reason, negativeOperatingIncome };
      });
    },
    atLatestClose() {
      const quarter = ends.at(-1);
      if (!quarter || !history || !basis || history.asOf < quarter) return null;
      const shares = basis.shares.get(quarter);
      const { point } = asOf(ends.length - 1, history.price, shares == null ? undefined : shares * basis.factorAfter(quarter));
      return point ? { ...point, priceAsOf: history.asOf } : null;
    },
    quarterlyResults,
    dailyHistory(filings: { date: string; filed?: string }[]): DailyValuation[] {
      if (!eligible || !history || !basis) return [];
      const latest = history.asOf;
      const start = `${Number(latest.slice(0, 4)) - 10}${latest.slice(4)}`;
      const firstFiled = new Map<string, string>();
      for (const { date, filed } of filings) {
        if (!filed || filed <= date || filed > latest) continue;
        const previous = firstFiled.get(date);
        if (!previous || filed < previous) firstFiled.set(date, filed);
      }
      const disclosures = [...firstFiled].map(([quarter, filed]) => ({
        quarter, filed, index: ends.indexOf(quarter),
      })).sort((a, b) => a.filed.localeCompare(b.filed) || a.quarter.localeCompare(b.quarter));
      let next = 0;
      let period: typeof disclosures[number] | undefined;
      const quarterInputs = ends.map((_, index) => fundamentalsAt(index));
      return history.dates.flatMap((date, priceIndex) => {
        if (date < start) return [];
        // Start at the next trading close so an after-hours filing never affects an earlier close.
        while (disclosures[next] && disclosures[next].filed < date) {
          const disclosure = disclosures[next++];
          if (!period || disclosure.quarter >= period.quarter) period = disclosure;
        }
        if (!period) return [];
        if (Date.parse(date) - Date.parse(period.filed) > MAX_DAILY_FINANCIAL_AGE) {
          return [{ date, filed: period.filed, point: null }];
        }
        const reportedShares = basis.shares.get(period.quarter);
        const shares = reportedShares == null ? undefined
          : reportedShares * basis.factorAfter(period.quarter) / basis.factorAfter(date);
        const result = asOf(period.index, history.rawCloses?.[priceIndex], shares, quarterInputs[period.index]);
        return [{ date, filed: period.filed, point: result.point ?? null }];
      });
    },
    history(): ValuationPoint[] {
      return quarterlyResults().flatMap(({ point }) => point ? [point] : []);
    },
  };
}

export function valuationBenchmark<T extends { quarter: string }>(
  points: T[],
  latest = points.at(-1)?.quarter,
  years = 10,
) {
  const start = latest ? `${Number(latest.slice(0, 4)) - years}${latest.slice(4)}` : null;
  return start ? points.filter(({ quarter }) => quarter > start) : [];
}

/** Years spanned by the first→last valuation point (0 if fewer than 2 points). */
export function valuationHistorySpanYears(points: { quarter: string }[]) {
  if (points.length < 2) return 0;
  return (Date.parse(points.at(-1)!.quarter) - Date.parse(points[0].quarter)) / (365.25 * DAY_MS);
}

const BALANCE_SHEET_GAP_REASONS = new Set(["missing cash", "missing debt", "missing usable shares"]);

/**
 * Decide whether to show the Valuation tab and which average window to use.
 * - <5Y usable history → hide
 * - 5–10Y → 5Y average
 * - ≥10Y → 10Y average
 * - Banks whose EV math goes ≤0 (or produces almost no usable points) → hide
 * - Material missing cash/debt/shares tags (≥4 quarters in the 10Y window) → hide
 */
export function resolveValuationDisplay(input: {
  points: ValuationPoint[];
  financialQuarters: { quarter: string; reason?: string }[];
  isFinancial?: boolean;
  latestEnterpriseValue?: number | null;
  hasNegativeOperatingIncome: boolean;
}) {
  const { points, financialQuarters, isFinancial, latestEnterpriseValue, hasNegativeOperatingIncome } = input;
  if (hasNegativeOperatingIncome) {
    return { show: true as const, averageYears: 10 as const, points, hideReason: null };
  }

  const balanceSheetGaps = financialQuarters.filter((r) => r.reason && BALANCE_SHEET_GAP_REASONS.has(r.reason)).length;
  if (balanceSheetGaps >= 4) {
    return { show: false as const, averageYears: null, points: [] as ValuationPoint[], hideReason: "missing-balance-sheet" as const };
  }

  // Banks/brokers: hide when the industrial EV formula is invalid or history collapses to <5Y.
  if (isFinancial && (latestEnterpriseValue != null && latestEnterpriseValue <= 0 || valuationHistorySpanYears(points) < 5)) {
    return { show: false as const, averageYears: null, points: [] as ValuationPoint[], hideReason: "financial-invalid-ev" as const };
  }

  const spanYears = valuationHistorySpanYears(points);
  if (points.length < 2 || spanYears < 5) {
    return { show: false as const, averageYears: null, points: [] as ValuationPoint[], hideReason: "insufficient-history" as const };
  }

  // 40 consecutive quarters span ~9.75 calendar years — treat >=9.5Y as a full 10Y window.
  const averageYears = spanYears >= 9.5 ? 10 as const : 5 as const;
  const windowed = valuationBenchmark(points, points.at(-1)?.quarter, averageYears);
  if (windowed.length < 2) {
    return { show: false as const, averageYears: null, points: [] as ValuationPoint[], hideReason: "insufficient-history" as const };
  }
  return { show: true as const, averageYears, points: windowed, hideReason: null };
}
