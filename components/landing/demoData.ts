/**
 * Landing-only sample market data.
 *
 * Nothing here is a real quote. Each series is a seeded random walk built from
 * integer hashing and basic arithmetic only, so the server render and the
 * browser produce identical numbers. Signals are derived from the series with
 * the same rule the platform uses, never hardcoded.
 */

export type DemoSignal = "Strong Buy" | "Buy" | "Hold";

export type DemoStock = {
  ticker: string;
  name: string;
  exchange: string;
  /** Last 252 sessions, oldest first. */
  closes: number[];
  shortSma: number[];
  longSma: number[];
  price: number;
  /** Latest session change, percent. */
  change: number;
  /** Return over the 252 sessions shown, percent. */
  yearReturn: number;
  low: number;
  high: number;
  /** Where the latest price sits in the 52-week range, 0–100. */
  position: number;
  signal: DemoSignal;
  reason: string;
};

type Leg = readonly [sessions: number, drift: number];

type Spec = {
  ticker: string;
  name: string;
  exchange: string;
  price: number;
  seed: number;
  /** Daily noise amplitude. */
  vol: number;
  /** Consecutive stretches of daily drift; the last one runs to the end. */
  legs: readonly Leg[];
};

const YEAR = 252;
const SHORT = 50;
const LONG = 200;
const TOTAL = YEAR + LONG - 1;

export const SIGNAL_REASON: Record<DemoSignal, string> = {
  "Strong Buy": "Price is below its 200-day SMA",
  Buy: "Price is below its 50-day SMA",
  Hold: "Price is above both averages",
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function movingAverage(history: number[], days: number) {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < history.length; i++) {
    sum += history[i];
    if (i >= days) sum -= history[i - days];
    if (i >= LONG - 1) out.push(sum / Math.min(days, i + 1));
  }
  return out;
}

/** Platform rule: below the long average is Strong Buy, below the short is Buy, otherwise Hold. */
export function signalFor(price: number, short: number, long: number): DemoSignal {
  return price < long ? "Strong Buy" : price < short ? "Buy" : "Hold";
}

function build(spec: Spec): DemoStock {
  const rand = mulberry32(spec.seed);
  const raw: number[] = [];
  let value = 100;
  let leg = 0;
  let legEnd = spec.legs[0][0];
  for (let i = 0; i < TOTAL; i++) {
    while (i >= legEnd && leg < spec.legs.length - 1) {
      leg++;
      legEnd += spec.legs[leg][0];
    }
    // Two draws averaged: fewer outsized single-day jumps than one uniform draw.
    const noise = (rand() + rand() - 1) * spec.vol;
    value *= 1 + spec.legs[leg][1] + noise;
    raw.push(value);
  }

  const scale = spec.price / raw[raw.length - 1];
  const history = raw.map((point) => round2(point * scale));
  const closes = history.slice(LONG - 1);
  const shortSma = movingAverage(history, SHORT).map(round2);
  const longSma = movingAverage(history, LONG).map(round2);

  const price = closes[closes.length - 1];
  const previous = closes[closes.length - 2];
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const signal = signalFor(price, shortSma[shortSma.length - 1], longSma[longSma.length - 1]);

  return {
    ticker: spec.ticker,
    name: spec.name,
    exchange: spec.exchange,
    closes,
    shortSma,
    longSma,
    price,
    change: (price / previous - 1) * 100,
    yearReturn: (price / closes[0] - 1) * 100,
    low,
    high,
    position: high > low ? ((price - low) / (high - low)) * 100 : 50,
    signal,
    reason: SIGNAL_REASON[signal],
  };
}

const SPECS: readonly Spec[] = [
  {
    ticker: "NVDA",
    name: "NVIDIA",
    exchange: "NASDAQ",
    price: 142.6,
    seed: 0x51a7e,
    vol: 0.021,
    legs: [[300, 0.0019], [95, 0.0012], [56, -0.0052]],
  },
  {
    ticker: "MSFT",
    name: "Microsoft",
    exchange: "NASDAQ",
    price: 438.2,
    seed: 0x2b3c4,
    vol: 0.014,
    legs: [[431, 0.0012], [20, -0.0026]],
  },
  {
    ticker: "COST",
    name: "Costco",
    exchange: "NASDAQ",
    price: 912.4,
    seed: 0x7d1e9,
    vol: 0.012,
    legs: [[330, 0.0008], [60, -0.0004], [61, 0.0021]],
  },
  {
    ticker: "LLY",
    name: "Eli Lilly",
    exchange: "NYSE",
    price: 587.3,
    seed: 0x3f9a2,
    vol: 0.018,
    legs: [[380, 0.0014], [71, 0.0004]],
  },
  {
    ticker: "AMZN",
    name: "Amazon",
    exchange: "NASDAQ",
    price: 201.8,
    seed: 0x64c05,
    vol: 0.017,
    legs: [[340, 0.001], [94, 0.0018], [17, -0.0016]],
  },
  {
    ticker: "GOOG",
    name: "Alphabet",
    exchange: "NASDAQ",
    price: 168.9,
    seed: 0x18e74,
    vol: 0.016,
    legs: [[290, 0.0013], [110, 0.0002], [51, -0.0031]],
  },
];

export const DEMO_STOCKS: readonly DemoStock[] = SPECS.map(build);

/** The three names the chart demo switches between — one per signal. */
export const CHART_TICKERS = ["NVDA", "MSFT", "COST"] as const;

export function demoStock(ticker: string): DemoStock {
  return DEMO_STOCKS.find((stock) => stock.ticker === ticker) ?? DEMO_STOCKS[0];
}

export function formatPrice(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPercent(value: number, digits = 1) {
  const fixed = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (value < 0 ? "−" : "+") + fixed + "%";
}
