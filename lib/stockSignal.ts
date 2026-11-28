import type { ValuationOverallSide } from "@/lib/valuationSignal";

export type StockSignal = "Sell" | "Hold" | "Buy" | "Strong Buy";

/** Strong Buy → Buy → Hold → Sell (lower = more bullish). Missing signals sort last. */
export function stockSignalRank(signal: StockSignal | null | undefined) {
  if (signal === "Strong Buy") return 0;
  if (signal === "Buy") return 1;
  if (signal === "Hold") return 2;
  if (signal === "Sell") return 3;
  return null;
}

export function movingAverage(prices: number[], end: number, days: number) {
  const start = Math.max(0, end - days + 1);
  const slice = prices.slice(start, end + 1);
  return slice.reduce((sum, price) => sum + price, 0) / slice.length;
}

/**
 * Trend + valuation signal for Graph Analysis and Watchlist.
 * Revenue growth under 5% TTM is always Sell.
 * When overall valuation is missing, fall back to the SMA-only rulebook.
 */
export function stockSignal(
  revenueGrowth: number | null,
  history: { price: number; closes: number[] } | null,
  valuation: ValuationOverallSide | null = null,
): StockSignal | null {
  if (revenueGrowth !== null && Number(revenueGrowth.toFixed(10)) < 5) return "Sell";
  if (!history || history.closes.length < 2) return null;

  const { price, closes } = history;
  const end = closes.length - 1;
  const sma50 = movingAverage(closes, end, 50);
  const sma200 = movingAverage(closes, end, 200);
  const below50 = price < sma50;
  const below200 = price < sma200;

  // No overall valuation (missing EV/NOPAT or adjusted P/E) → SMA + revenue only.
  // Above 50 / below 200 stays Hold (do not treat every below-200 print as Strong Buy).
  if (valuation == null) {
    if (below50 && below200) return "Strong Buy";
    if (below50 && !below200) return "Buy";
    return "Hold";
  }

  const growing = revenueGrowth !== null && Number(revenueGrowth.toFixed(10)) >= 5;

  // Above both SMAs → Hold; Buy only if undervalued and growing.
  if (!below50 && !below200) {
    return valuation === "below" && growing ? "Buy" : "Hold";
  }

  // Below 50-day, above 200-day → Buy unless overvalued.
  if (below50 && !below200) {
    return valuation === "above" ? "Hold" : "Buy";
  }

  // Below both SMAs → Strong Buy / Buy / Hold by valuation.
  if (below50 && below200) {
    if (valuation === "above") return "Hold";
    if (valuation === "below" && growing) return "Strong Buy";
    return "Buy";
  }

  // Above 50-day, below 200-day → Hold; Buy if undervalued and growing.
  return valuation === "below" && growing ? "Buy" : "Hold";
}

export function stockSignalClass(signal: StockSignal | null | undefined) {
  if (!signal) return undefined;
  return signal === "Sell" ? "stock-negative" : signal === "Hold" ? "stock-neutral" : "stock-positive";
}

/** Drop invalid chart closes and recalculate the price summary if any were removed. */
export function sanitizeHistory<T extends {
  dates: string[]; closes: number[]; price: number; change: number; high52: number; low52: number;
}>(history: T): T {
  const dates: string[] = [];
  const closes: number[] = [];
  for (let index = 0; index < history.closes.length; index++) {
    const close = history.closes[index];
    if (!Number.isFinite(close) || close <= 0) continue;
    dates.push(history.dates[index] ?? "");
    closes.push(close);
  }
  if (closes.length === history.closes.length || closes.length < 2) return history;
  const price = closes[closes.length - 1];
  const previous = closes[closes.length - 2];
  const year = closes.slice(-252);
  return { ...history, dates, closes, price, change: (price / previous - 1) * 100,
    high52: Math.max(...year), low52: Math.min(...year) };
}
