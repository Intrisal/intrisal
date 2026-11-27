/** Buy-and-hold portfolio simulation from stored EOD closes. */

export type SimRange = "1Y" | "2Y" | "5Y" | "10Y";

export type SimHolding = {
  ticker: string;
  /** Dollars of starting capital assigned to this ticker. */
  amount: number;
};

export type SimState = {
  /** Total starting capital in dollars. Unassigned dollars stay in cash. */
  capital: number;
  holdings: SimHolding[];
  range: SimRange;
  showSpy: boolean;
};

export const SIM_RANGES: SimRange[] = ["1Y", "2Y", "5Y", "10Y"];

export const SIM_RANGE_YEARS: Record<SimRange, number> = {
  "1Y": 1,
  "2Y": 2,
  "5Y": 5,
  "10Y": 10,
};

export const SIM_DEFAULT: SimState = {
  capital: 10_000,
  holdings: [],
  range: "5Y",
  showSpy: false,
};

const MS_PER_YEAR = 365.25 * 86_400_000;

/** Tickers eligible for simulation must have ~10Y of stored closes. */
export function hasTenYearPriceHistory(dates: string[]): boolean {
  if (dates.length < 2) return false;
  const first = Date.parse(dates[0]! + "T00:00:00Z");
  const last = Date.parse(dates.at(-1)! + "T00:00:00Z");
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return false;
  return (last - first) / MS_PER_YEAR >= 9;
}

export function allocatedAmount(holdings: SimHolding[]) {
  return holdings.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0);
}

export function cashAmount(capital: number, holdings: SimHolding[]) {
  return Math.max(0, capital - allocatedAmount(holdings));
}

export function holdingWeight(amount: number, capital: number) {
  if (!(capital > 0) || !(amount > 0)) return 0;
  return (amount / capital) * 100;
}

/** Split capital across n holdings in cents so the amounts sum exactly to capital. */
export function evenCapitalAmounts(capital: number, count: number): number[] {
  if (count <= 0) return [];
  const totalCents = Math.max(0, Math.round(capital * 100));
  const base = Math.floor(totalCents / count);
  const rem = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < rem ? 1 : 0)) / 100);
}

export type PriceSeries = {
  ticker: string;
  dates: string[];
  closes: number[];
};

export type PortfolioPath = {
  dates: string[];
  /** Portfolio value path scaled to $100 starting capital. */
  values: number[];
  /** Ending value of $100 invested at the path start. */
  endValue: number;
  /** Absolute gain/loss vs $100. */
  difference: number;
  /** Annualized return over the actual path span. */
  cagr: number;
  /** Calendar years used for CAGR. */
  years: number;
};

function cutoffDate(latest: string, years: number) {
  const d = new Date(latest + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function forwardFillMap(dates: string[], closes: number[]) {
  const map = new Map<string, number>();
  for (let i = 0; i < dates.length; i++) {
    const close = closes[i];
    if (typeof close === "number" && Number.isFinite(close) && close > 0) {
      map.set(dates[i]!, close);
    }
  }
  return map;
}

/**
 * Align a benchmark series (e.g. SPY) onto portfolio dates as a $100 path.
 * Uses the last known close on or before each date.
 */
export function buildBenchmarkPath(
  series: PriceSeries | null | undefined,
  dates: string[],
): number[] | null {
  if (!series?.dates.length || series.dates.length !== series.closes.length || dates.length < 2) {
    return null;
  }
  const start = dates[0]!;
  let cursor = 0;
  let last: number | null = null;
  while (cursor < series.dates.length && series.dates[cursor]! <= start) {
    const close = series.closes[cursor]!;
    if (typeof close === "number" && Number.isFinite(close) && close > 0) last = close;
    cursor++;
  }
  if (last == null) return null;
  const base = last;
  const values: number[] = [];
  for (const date of dates) {
    while (cursor < series.dates.length && series.dates[cursor]! <= date) {
      const close = series.closes[cursor]!;
      if (typeof close === "number" && Number.isFinite(close) && close > 0) last = close;
      cursor++;
    }
    if (last == null) return null;
    values.push(100 * (last / base));
  }
  return values;
}

/**
 * Build a $100 buy-and-hold path. Unallocated capital stays in cash (0% return).
 * Paths start on the first date every equity holding has a price in-range.
 */
export function buildPortfolioPath(
  capital: number,
  holdings: SimHolding[],
  seriesByTicker: Record<string, PriceSeries | null | undefined>,
  range: SimRange,
): PortfolioPath | null {
  const total = capital > 0 ? capital : 0;
  const active = holdings.filter((row) => row.amount > 0);
  const cash = cashAmount(total, holdings);
  const cashWeight = total > 0 ? (cash / total) * 100 : 100;

  if (!active.length) {
    return {
      dates: [],
      values: [100],
      endValue: 100,
      difference: 0,
      cagr: 0,
      years: SIM_RANGE_YEARS[range],
    };
  }

  const prepared: { weight: number; map: Map<string, number>; dates: string[] }[] = [];
  let latest = "";
  for (const row of active) {
    const series = seriesByTicker[row.ticker];
    if (!series?.dates.length || series.dates.length !== series.closes.length) return null;
    const last = series.dates.at(-1)!;
    if (last > latest) latest = last;
  }
  if (!latest) return null;

  const from = cutoffDate(latest, SIM_RANGE_YEARS[range]);
  let start = from;

  for (const row of active) {
    const series = seriesByTicker[row.ticker]!;
    const map = forwardFillMap(series.dates, series.closes);
    const inRange = series.dates.filter((date) => date >= from);
    if (inRange.length < 2) return null;
    const first = inRange[0]!;
    if (first > start) start = first;
    prepared.push({
      weight: holdingWeight(row.amount, total),
      map,
      dates: inRange,
    });
  }

  const dateSet = new Set<string>();
  for (const item of prepared) {
    for (const date of item.dates) {
      if (date >= start) dateSet.add(date);
    }
  }
  const dates = [...dateSet].sort();
  if (dates.length < 2) return null;

  const lastPrice = prepared.map(() => 0);
  const values: number[] = [];
  for (const date of dates) {
    let totalValue = cashWeight;
    for (let i = 0; i < prepared.length; i++) {
      const px = prepared[i]!.map.get(date);
      if (px != null) lastPrice[i] = px;
      const base = prepared[i]!.map.get(start) ?? lastPrice[i];
      if (!base || !lastPrice[i]) return null;
      totalValue += prepared[i]!.weight * (lastPrice[i]! / base);
    }
    values.push(totalValue);
  }

  const endValue = values.at(-1)!;
  const firstMs = Date.parse(dates[0]! + "T00:00:00Z");
  const lastMs = Date.parse(dates.at(-1)! + "T00:00:00Z");
  const years = Math.max((lastMs - firstMs) / MS_PER_YEAR, 1 / 365);
  const cagr = endValue > 0 ? Math.pow(endValue / 100, 1 / years) - 1 : -1;

  return {
    dates,
    values,
    endValue,
    difference: endValue - 100,
    cagr,
    years,
  };
}

/** Evenly spaced nice ticks between min and max (inclusive-ish). */
export function niceAxisTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const rough = (max - min) / Math.max(1, count - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rough, Number.EPSILON))));
  const normalized = rough / pow;
  const step = (normalized <= 1.5 ? 1 : normalized <= 3 ? 2 : normalized <= 7 ? 5 : 10) * pow;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 0.01; value += step) {
    if (value >= min - step * 0.01) ticks.push(value);
  }
  return ticks.length ? ticks : [min, max];
}
