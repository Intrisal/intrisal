export const CATALOG: ReadonlyArray<readonly [string, string]> = [
  ["VFV", "Vanguard S&P 500 Index ETF"],
  ["META", "Meta Platforms"],
  ["GOOG", "Alphabet (Google)"],
  ["MSFT", "Microsoft"],
  ["AMZN", "Amazon"],
  ["NFLX", "Netflix"],
  ["NVDA", "NVIDIA"],
  ["ASML", "ASML Holding"],
  ["MA", "Mastercard"],
  ["ISRG", "Intuitive Surgical"],
  ["AAPL", "Apple"],
  ["TSLA", "Tesla"],
  ["V", "Visa"],
  ["UNH", "UnitedHealth"],
  ["JPM", "JPMorgan Chase"],
  ["BRK.B", "Berkshire Hathaway"],
  ["LLY", "Eli Lilly"],
  ["AVGO", "Broadcom"],
  ["COST", "Costco"],
  ["HD", "Home Depot"],
  ["WMT", "Walmart"],
  ["XOM", "Exxon Mobil"],
  ["AMD", "Advanced Micro Devices"],
  ["CRM", "Salesforce"],
  ["SHOP", "Shopify"],
  ["QQQ", "Invesco QQQ Trust"],
  ["SPY", "SPDR S&P 500 ETF"],
  ["UBER", "Uber Technologies"],
  ["PLTR", "Palantir"],
  ["COIN", "Coinbase"],
];

export const DEFAULT_WATCHLIST = ["VFV", "META", "GOOG", "MSFT", "AMZN", "NFLX", "NVDA", "ASML", "MA", "ISRG"];

export type Sample = {
  price: number;
  change: number;
  fpe: number;
  evn: number;
  avg: number;
  rev: number;
  growth: number;
  eps: number;
  fcf: number;
  opinc: number;
  de: string;
};

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nameOf(tk: string): string {
  for (let i = 0; i < CATALOG.length; i++) if (CATALOG[i][0] === tk) return CATALOG[i][1];
  return tk;
}

export function sample(tk: string): Sample {
  const r = rng(hashStr(tk));
  const price = 24 + r() * 780;
  const change = r() * 8 - 3.6;
  const fpe = 9 + r() * 34;
  const evn = 11 + r() * 38;
  const avg = evn * (0.82 + r() * 0.4);
  const rev = 18 + r() * 380;
  const growth = 4 + r() * 26;
  return {
    price,
    change,
    fpe,
    evn,
    avg,
    rev,
    growth,
    eps: price / (fpe * (0.9 + r() * 0.3)),
    fcf: rev * (0.14 + r() * 0.2),
    opinc: rev * (0.18 + r() * 0.22),
    de: (r() * 1.6).toFixed(2),
  };
}

export function series(tk: string, rangeKey: string, points: number): number[] {
  const r = rng(hashStr(tk + ":" + rangeKey));
  const drift = (r() - 0.42) * 0.004;
  let v = 100;
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    v *= 1 + drift + (r() - 0.5) * 0.028;
    out.push(v);
  }
  const s = sample(tk);
  const scale = s.price / out[out.length - 1];
  return out.map(function (x) {
    return x * scale;
  });
}

export function fmt(n: number, d: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function searchCatalog(query: string): Array<readonly [string, string]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return CATALOG.filter(function (e) {
    return e[0].toLowerCase().indexOf(q) === 0 || e[0].toLowerCase().indexOf(q) !== -1 || e[1].toLowerCase().indexOf(q) !== -1;
  }).slice(0, 8);
}

export type SimInput = {
  start: string;
  monthly: string;
  years: number;
  annual: number;
};

export const SIM_DEFAULT: SimInput = { start: "10000", monthly: "250", years: 20, annual: 9 };

export function projectSim(sim: SimInput) {
  const start = parseFloat(sim.start) || 0;
  const monthly = parseFloat(sim.monthly) || 0;
  const years = sim.years;
  const ret = sim.annual / 100;
  const mr = Math.pow(1 + ret, 1 / 12) - 1;
  let bal = start;
  let contributed = start;
  const pts = [start];
  for (let m = 1; m <= years * 12; m++) {
    bal = bal * (1 + mr) + monthly;
    contributed += monthly;
    if (m % 12 === 0) pts.push(bal);
  }
  return {
    bal,
    contributed,
    years,
    pts,
    returnLabel: fmt(ret * 100, 1).replace(/\.0$/, "") + "%",
  };
}
