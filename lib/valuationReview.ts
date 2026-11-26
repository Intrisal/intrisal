import type { EdgarFundamentals, QuarterlySeries } from "@/lib/edgar";
import type { StockHistory } from "@/lib/marketstack";
import type { ValuationPoint } from "@/lib/stockStore";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";

const REVIEW_EXCLUDED = new Set(["ASML", "CCEP", "FER", "NBIS", "PDD", "TEST"]);
const SPLIT_RATIOS = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 15, 16, 20, 25, 30, 40, 50, 100];

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
  const hasInvestments = Object.values(edgar.balances).some((balance) => balance?.sti != null);
  const basis = history ? sharesOnPriceBasis(edgar, history) : null;

  function asOf(index: number, close: number | undefined | null, shares: number | undefined) {
    const quarter = ends[index];
    if (!canReviewValuation(ticker, edgar) || edgar.reportingCurrency === "EUR") return { reason: "ineligible filing or currency" } as const;
    if (index < 3) return { reason: "fewer than four operating quarters" } as const;
    const window = ends.slice(index - 3, index + 1);
    if (window.slice(1).some((date, i) => !isFiscalQuarterGap((Date.parse(date) - Date.parse(window[i])) / DAY_MS))) {
      return { reason: "nonconsecutive operating quarters" } as const;
    }
    if (close == null || !Number.isFinite(close) || close <= 0) return { reason: "missing usable closing price" } as const;

    const balance = edgar.balances[quarter];
    if (balance?.cash == null) return { reason: "missing cash" } as const;
    if (balance.debt == null) return { reason: "missing debt" } as const;
    if (shares == null) return { reason: "missing usable shares" } as const;
    if (hasInvestments && balance.sti == null) return { reason: "missing short-term investments" } as const;
    const ev = close * shares + balance.debt - balance.cash - (balance.sti ?? 0);
    const sum = (metric: Map<string, number>) => {
      const data = window.map((date) => metric.get(date));
      return data.reduce<number | null>((total, value) => total != null && value != null && Number.isFinite(value)
        ? total + value : null, 0);
    };
    const taxSum = sum(tax);
    const pretaxSum = sum(pretax);
    const rate = taxSum != null && pretaxSum != null && pretaxSum > 0
      ? Math.min(0.35, Math.max(0, taxSum / pretaxSum)) : 0.21;
    const nopat = values.slice(index - 3, index + 1).reduce((total, value) => total + value, 0) * (1 - rate);
    if (!Number.isFinite(ev) || ev <= 0) return { reason: "nonpositive or invalid EV" } as const;
    if (!Number.isFinite(nopat) || nopat <= 0) return { reason: "nonpositive or invalid NOPAT" } as const;
    const estimatedShares = balance.reportedShares == null && balance.sharesEstimated === true;
    return {
      point: { quarter, close, ev, nopat, ev_nopat: ev / nopat, ...(estimatedShares ? { sharesEstimated: true } : {}) },
      rate, estimatedShares,
    } as const;
  }

  function quarterlyResults() {
    const latest = ends.at(-1);
    const window = valuationBenchmark(ends.map((quarter, index) => ({ quarter, index })), latest).slice(-40);
    return window.map(({ quarter, index }) => {
      const priceIndex = history?.dates.findLastIndex((date) => date <= quarter) ?? -1;
      const close = history && priceIndex >= 0 && Date.parse(quarter) - Date.parse(history.dates[priceIndex]) <= 7 * DAY_MS
        ? history.rawCloses?.[priceIndex] : null;
      return { quarter, ...asOf(index, close, basis?.shares.get(quarter)) };
    });
  }

  return {
    atLatestClose() {
      const quarter = ends.at(-1);
      if (!quarter || !history || !basis || history.asOf < quarter) return null;
      const shares = basis.shares.get(quarter);
      const { point } = asOf(ends.length - 1, history.price, shares == null ? undefined : shares * basis.factorAfter(quarter));
      return point ? { ...point, priceAsOf: history.asOf } : null;
    },
    quarterlyResults,
    history(): ValuationPoint[] {
      return quarterlyResults().flatMap(({ point }) => point ? [point] : []);
    },
  };
}

export function valuationBenchmark<T extends { quarter: string }>(points: T[], latest = points.at(-1)?.quarter) {
  const start = latest ? `${Number(latest.slice(0, 4)) - 10}${latest.slice(4)}` : null;
  return start ? points.filter(({ quarter }) => quarter > start) : [];
}
