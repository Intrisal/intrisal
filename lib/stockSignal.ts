export type StockSignal = "Sell" | "Hold" | "Buy" | "Strong Buy";

export function movingAverage(prices: number[], end: number, days: number) {
  const start = Math.max(0, end - days + 1);
  const slice = prices.slice(start, end + 1);
  return slice.reduce((sum, price) => sum + price, 0) / slice.length;
}

export function stockSignal(revenueGrowth: number | null, history: { price: number; closes: number[] } | null): StockSignal | null {
  if (revenueGrowth !== null && Number(revenueGrowth.toFixed(10)) < 5) return "Sell";
  if (!history || history.closes.length < 2) return null;

  const { price, closes } = history;
  if (price < movingAverage(closes, closes.length - 1, 200)) return "Strong Buy";
  if (price < movingAverage(closes, closes.length - 1, 50)) return "Buy";
  return "Hold";
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
