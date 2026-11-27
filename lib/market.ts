type Exchange = "NASDAQ" | "NYSE" | "NYSE Arca" | "TSX";
type CatalogEntry = readonly [ticker: string, name: string, exchange: Exchange];

export function normalizeTicker(ticker: string) {
  const id = ticker.trim().toUpperCase();
  // Normalize SEC share-class hyphens (BRK-B, BF-B) to the dot convention stored in Supabase.
  return /^([A-Z]{1,5})-([A-Z])$/.test(id) ? id.replace("-", ".") : id;
}

export const CATALOG: readonly CatalogEntry[] = [
  ["VFV", "Vanguard S&P 500 Index ETF", "TSX"],
  ["META", "Meta Platforms", "NASDAQ"],
  ["GOOG", "Alphabet (Google)", "NASDAQ"],
  ["MSFT", "Microsoft", "NASDAQ"],
  ["AMZN", "Amazon", "NASDAQ"],
  ["NFLX", "Netflix", "NASDAQ"],
  ["NVDA", "NVIDIA", "NASDAQ"],
  ["ASML", "ASML Holding", "NASDAQ"],
  ["MA", "Mastercard", "NYSE"],
  ["ISRG", "Intuitive Surgical", "NASDAQ"],
  ["AAPL", "Apple", "NASDAQ"],
  ["TSLA", "Tesla", "NASDAQ"],
  ["V", "Visa", "NYSE"],
  ["UNH", "UnitedHealth", "NYSE"],
  ["JPM", "JPMorgan Chase", "NYSE"],
  ["BRK.B", "Berkshire Hathaway", "NYSE"],
  ["LLY", "Eli Lilly", "NYSE"],
  ["AVGO", "Broadcom", "NASDAQ"],
  ["COST", "Costco", "NASDAQ"],
  ["HD", "Home Depot", "NYSE"],
  ["WMT", "Walmart", "NASDAQ"],
  ["XOM", "Exxon Mobil", "NYSE"],
  ["AMD", "Advanced Micro Devices", "NASDAQ"],
  ["CRM", "Salesforce", "NYSE"],
  ["SHOP", "Shopify", "NASDAQ"],
  ["QQQ", "Invesco QQQ Trust", "NASDAQ"],
  ["SPY", "SPDR S&P 500 ETF", "NYSE Arca"],
  ["UBER", "Uber Technologies", "NYSE"],
  ["PLTR", "Palantir", "NASDAQ"],
  ["COIN", "Coinbase", "NASDAQ"],
];

export const DEFAULT_WATCHLIST = ["VFV", "META", "GOOG", "MSFT", "AMZN", "NFLX", "NVDA", "ASML"];

const FUND_TICKERS = new Set(["VFV", "QQQ", "SPY"]);

export function isKnownFund(ticker: string) {
  return FUND_TICKERS.has(ticker.trim().toUpperCase());
}

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
  marketCapBillions: number | null;
  dividendYieldPercent: number;
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
  const id = normalizeTicker(tk);
  for (let i = 0; i < CATALOG.length; i++) if (CATALOG[i][0] === id) return CATALOG[i][1];
  return id;
}

/** Prefer curated catalog names; otherwise clean an EDGAR/Supabase entity name for display. */
export function displayCompanyName(ticker: string, rawName?: string | null): string {
  const id = normalizeTicker(ticker);
  const catalog = nameOf(id);
  if (catalog !== id) return catalog;
  const cleaned = formatEntityName(rawName);
  return cleaned || id;
}

function formatEntityName(rawName?: string | null) {
  if (!rawName?.trim()) return "";
  let name = rawName.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  name = name
    .replace(/,?\s*\b(incorporated|corporation|company|limited|inc|corp|ltd|co|plc|nv|sa)\b\.?$/i, "")
    .replace(/,+$/g, "")
    .replace(/^the\s+/i, "")
    .trim();
  if (!name) return rawName.trim();
  // SEC names are often ALL CAPS — title-case them for the identity header.
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) {
    name = name.toLowerCase().replace(/\b[a-z0-9]/g, (ch) => ch.toUpperCase());
  }
  return name;
}

export function exchangeOf(tk: string): Exchange | undefined {
  return CATALOG.find(([ticker]) => ticker === tk)?.[2];
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
  const isFund = isKnownFund(tk);
  const snapshotRandom = rng(hashStr(tk + ":snapshot"));
  const sharesBillions = 0.15 + snapshotRandom() * 5;
  const [, yieldRoll, positiveYield] = [
    snapshotRandom(), snapshotRandom(), snapshotRandom(),
  ];
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
    marketCapBillions: isFund ? null : price * sharesBillions,
    dividendYieldPercent: !isFund && yieldRoll < 0.3 ? 0 : 0.2 + positiveYield * 3.5,
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

/** Lower score = better match. Used by catalog search and SEC directory search. */
export function searchMatchScore(query: string, ticker: string, name: string) {
  const q = query.trim().toUpperCase();
  const normalizedQuery = normalizeTicker(q);
  const id = normalizeTicker(ticker);
  const label = name.toUpperCase();
  if (!normalizedQuery) return Number.POSITIVE_INFINITY;
  if (id === normalizedQuery) return 0;
  if (id.startsWith(normalizedQuery)) return 100 + id.length;
  if (label.startsWith(normalizedQuery)) return 200 + Math.min(label.length, 80);
  // Prefer "MA" matching "Mastercard" over "Amazon" (substring mid-word).
  const wordStart = new RegExp(`(?:^|[\\s,.(/-])${normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  if (wordStart.test(label)) return 300 + Math.min(label.length, 80);
  if (label.includes(normalizedQuery)) return 400 + Math.min(label.indexOf(normalizedQuery), 40) + Math.min(label.length, 80);
  if (id.includes(normalizedQuery)) return 500 + id.length;
  return Number.POSITIVE_INFINITY;
}

export function searchCatalog(query: string): CatalogEntry[] {
  const q = query.trim();
  if (!q) return [];
  return CATALOG
    .map((entry) => ({ entry, score: searchMatchScore(q, entry[0], entry[1]) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.entry[0].localeCompare(b.entry[0]))
    .slice(0, 8)
    .map(({ entry }) => entry);
}

