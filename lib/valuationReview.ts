import type { EdgarFundamentals, QuarterlySeries } from "@/lib/edgar";
import type { StockHistory } from "@/lib/marketstack";
import type { ValuationPoint } from "@/lib/stockStore";

const DAY_MS = 86_400_000;

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
    const reported = edgar.balances[date]?.shares;
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

  function asOf(index: number, close: number, shares: number | undefined): ValuationPoint | null {
    if (index < 3 || !canReviewValuation(ticker, edgar) || edgar.reportingCurrency === "EUR" || !Number.isFinite(close) || close <= 0) return null;
    const quarter = ends[index];
    const window = ends.slice(index - 3, index + 1);
    if (window.slice(1).some((date, i) => {
      const days = (Date.parse(date) - Date.parse(window[i])) / DAY_MS;
      return !Number.isFinite(days) || days < 70 || days > 110;
    })) return null;

    const balance = edgar.balances[quarter];
    if (!balance || balance.cash == null || balance.debt == null || shares == null) return null;
    if (hasInvestments && balance.sti == null) return null;
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
    if (!Number.isFinite(ev) || !Number.isFinite(nopat) || ev <= 0 || nopat <= 0) return null;
    return { quarter, close, ev, nopat, ev_nopat: ev / nopat };
  }

  return {
    atLatestClose() {
      const quarter = ends.at(-1);
      if (!quarter || !history || !basis || history.asOf < quarter) return null;
      const shares = basis.shares.get(quarter);
      const point = asOf(ends.length - 1, history.price, shares == null ? undefined : shares * basis.factorAfter(quarter));
      return point ? { ...point, priceAsOf: history.asOf } : null;
    },
    history(): ValuationPoint[] {
      if (!history?.rawCloses || !canReviewValuation(ticker, edgar) || edgar.reportingCurrency === "EUR") return [];
      const points: ValuationPoint[] = [];
      for (let i = ends.length - 1; i >= 3 && points.length < 40; i--) {
        const quarter = ends[i];
        const priceIndex = history.dates.findLastIndex((date) => date <= quarter);
        if (priceIndex < 0) break;
        const close = history.rawCloses[priceIndex];
        if (close == null || Date.parse(quarter) - Date.parse(history.dates[priceIndex]) > 7 * DAY_MS) continue;
        const point = asOf(i, close, basis?.shares.get(quarter));
        if (point) points.push(point);
      }
      return valuationBenchmark(points.reverse());
    },
  };
}

export function valuationBenchmark(points: ValuationPoint[]) {
  const latest = points.at(-1)?.quarter;
  const start = latest ? `${Number(latest.slice(0, 4)) - 10}${latest.slice(4)}` : null;
  return start ? points.filter(({ quarter }) => quarter > start) : [];
}
