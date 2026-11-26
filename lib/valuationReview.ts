import type { EdgarFundamentals, QuarterlySeries } from "@/lib/edgar";
import type { StockHistory } from "@/lib/marketstack";
import type { ValuationPoint } from "@/lib/stockStore";

const DAY_MS = 86_400_000;

// The 2022 filings restate these legacy snapshots' shares for 20-for-1 splits.
// Convert only the known restated values so they match the raw quarter-end close.
const ALPHABET_RESTATED_SHARES = { "2021-12-31": 13.242, "2022-06-30": 13.078 };
const RESTATED_SHARES: Record<string, Record<string, number>> = {
  AMZN: { "2021-12-31": 10.175 },
  GOOG: ALPHABET_RESTATED_SHARES,
  GOOGL: ALPHABET_RESTATED_SHARES,
};
const REVIEW_EXCLUDED = new Set(["ASML", "CCEP", "FER", "NBIS", "PDD", "TEST"]);

export function canReviewValuation(ticker: string, edgar: EdgarFundamentals | null) {
  return Boolean(edgar && edgar.source !== "edgar-6k" && !REVIEW_EXCLUDED.has(ticker));
}

function valuesByDate(series: QuarterlySeries) {
  return new Map(series.ends.map((date, index) => [date, series.values[index]]));
}

export function prepareValuationReview(ticker: string, edgar: EdgarFundamentals) {
  const { ends, values } = edgar.operatingIncome;
  const tax = valuesByDate(edgar.tax);
  const pretax = valuesByDate(edgar.pretax);
  const hasInvestments = Object.values(edgar.balances).some((balance) => balance?.sti != null);

  function asOf(index: number, close: number): ValuationPoint | null {
    if (index < 3 || !canReviewValuation(ticker, edgar) || edgar.reportingCurrency === "EUR" || !Number.isFinite(close) || close <= 0) return null;
    const quarter = ends[index];
    const window = ends.slice(index - 3, index + 1);
    if (window.slice(1).some((date, i) => {
      const days = (Date.parse(date) - Date.parse(window[i])) / DAY_MS;
      return !Number.isFinite(days) || days < 70 || days > 110;
    })) return null;

    const balance = edgar.balances[quarter];
    if (!balance || balance.cash == null || balance.debt == null || balance.shares == null || balance.shares <= 0) return null;
    if (hasInvestments && balance.sti == null) return null;
    const reportedShares = RESTATED_SHARES[ticker]?.[quarter];
    const shares = reportedShares === balance.shares ? balance.shares / 20 : balance.shares;
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
    atLatestClose: (close: number) => asOf(ends.length - 1, close),
    history(history: StockHistory | null): ValuationPoint[] {
      if (!history?.rawCloses || !canReviewValuation(ticker, edgar) || edgar.reportingCurrency === "EUR") return [];
      const points: ValuationPoint[] = [];
      for (let i = ends.length - 1; i >= 3 && points.length < 40; i--) {
        const quarter = ends[i];
        const priceIndex = history.dates.findLastIndex((date) => date <= quarter);
        if (priceIndex < 0) break;
        const close = history.rawCloses[priceIndex];
        if (close == null || Date.parse(quarter) - Date.parse(history.dates[priceIndex]) > 7 * DAY_MS) continue;
        const point = asOf(i, close);
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
