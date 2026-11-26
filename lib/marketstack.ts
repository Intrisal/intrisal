/**
 * Server-only Marketstack client. Keep MARKETSTACK_API_KEY off the client.
 *
 * Quota model (Free ≈ 100 calls/month):
 * - EOD prices only change once per trading day, so we persist them to disk and
 *   reuse until the next UTC day (or MARKETSTACK_CACHE_HOURS if set).
 * - Opening a stock and loading the watchlist should share one history fetch
 *   when possible (history also seeds the quote cache).
 * - Slow fields (earnings, dividend yield, fundamentals) are NOT fetched here yet;
 *   when added they should be stored until their own refresh rule says so.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const BASE = "https://api.marketstack.com/v2";
/** Default: keep EOD payloads for a full day — prices do not change intraday on Free EOD. */
const DEFAULT_CACHE_HOURS = 24;

/** Intrisal tickers → Marketstack symbols (periods become hyphens; TSX needs .TO). */
const SYMBOL_MAP: Record<string, string> = {
  "BRK.B": "BRK-B",
  VFV: "VFV.TO",
};

export type EodBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type StockHistory = {
  symbol: string;
  ticker: string;
  dates: string[];
  closes: number[];
  price: number;
  change: number;
  high52: number;
  low52: number;
  asOf: string;
  source: "marketstack" | "unavailable";
};

export type StockQuote = {
  ticker: string;
  price: number;
  change: number;
  date: string;
  source: "marketstack" | "unavailable";
};

type CacheEntry<T> = { at: number; value: T };

type DiskCache = {
  history: Record<string, CacheEntry<StockHistory>>;
  quotes: Record<string, CacheEntry<StockQuote>>;
};

const memory: DiskCache = { history: {}, quotes: {} };
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "marketstack.json");

function apiKey() {
  return process.env.MARKETSTACK_API_KEY?.trim() ?? "";
}

function cacheTtlMs() {
  const hours = Number(process.env.MARKETSTACK_CACHE_HOURS);
  const resolved = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_CACHE_HOURS;
  return resolved * 60 * 60 * 1000;
}

function isFresh(at: number) {
  return Date.now() - at < cacheTtlMs();
}

function loadDiskCache() {
  try {
    if (!existsSync(CACHE_FILE)) return;
    const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as DiskCache;
    if (parsed.history) Object.assign(memory.history, parsed.history);
    if (parsed.quotes) Object.assign(memory.quotes, parsed.quotes);
  } catch {
    /* ignore corrupt cache */
  }
}

let diskLoaded = false;
function ensureDisk() {
  if (diskLoaded) return;
  diskLoaded = true;
  loadDiskCache();
}

function persistDisk() {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(memory), "utf8");
  } catch {
    /* serverless / read-only fs — memory cache still helps within the process */
  }
}

export function marketstackSymbol(ticker: string) {
  const id = ticker.trim().toUpperCase();
  return SYMBOL_MAP[id] ?? id.replace(/\./g, "-");
}

export function hasMarketstackKey() {
  return Boolean(apiKey());
}

async function marketstackGet<T>(pathName: string, params: Record<string, string>): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("MARKETSTACK_API_KEY is not set");

  const url = new URL(BASE + pathName);
  url.searchParams.set("access_key", key);
  for (const [name, value] of Object.entries(params)) {
    if (value) url.searchParams.set(name, value);
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const body = (await res.json()) as T & { error?: { code?: string; message?: string } };
  if (!res.ok || body.error) {
    const message = body.error?.message || res.statusText || "Marketstack request failed";
    throw new Error(message);
  }
  return body;
}

type EodResponse = {
  pagination?: { total?: number; count?: number; limit?: number; offset?: number };
  data?: Array<{
    symbol?: string;
    date?: string;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    adj_close?: number;
    volume?: number | null;
  }>;
};

function toDay(iso: string) {
  return iso.slice(0, 10);
}

function yearsAgoIso(years: number) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function quoteFromHistory(history: StockHistory): StockQuote {
  return {
    ticker: history.ticker,
    price: history.price,
    change: history.change,
    date: history.asOf,
    source: history.source,
  };
}

function isValidClose(close: number | null | undefined): close is number {
  return typeof close === "number" && Number.isFinite(close) && close > 0;
}

function buildHistory(ticker: string, bars: EodBar[]): StockHistory {
  // Marketstack occasionally returns close=0 on halt/holiday glitches — drop those bars
  // so charts don't spike to the axis (seen on META 2026-04-07/08 and 2026-06-04).
  const sorted = [...bars]
    .filter((bar) => isValidClose(bar.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  const dates = sorted.map((bar) => bar.date);
  const closes = sorted.map((bar) => bar.close);
  const price = closes[closes.length - 1];
  const prev = closes.length > 1 ? closes[closes.length - 2] : price;
  const change = prev ? ((price - prev) / prev) * 100 : 0;
  const year = closes.slice(-252);
  return {
    symbol: marketstackSymbol(ticker),
    ticker: ticker.toUpperCase(),
    dates,
    closes,
    price,
    change,
    high52: year.length ? Math.max(...year) : price,
    low52: year.length ? Math.min(...year) : price,
    asOf: dates[dates.length - 1] ?? "",
    source: "marketstack",
  };
}

function storeHistory(history: StockHistory) {
  const entry = { at: Date.now(), value: history };
  memory.history[history.ticker] = entry;
  // One history call also satisfies quote needs for that ticker.
  memory.quotes[history.ticker] = { at: entry.at, value: quoteFromHistory(history) };
  persistDisk();
}

function sanitizeHistory(history: StockHistory): StockHistory | null {
  const pairs = history.dates
    .map((date, index) => ({ date, close: history.closes[index] }))
    .filter((row) => isValidClose(row.close));
  if (pairs.length < 2) return null;
  if (pairs.length === history.closes.length) return history;
  return buildHistory(
    history.ticker,
    pairs.map((row) => ({
      date: row.date,
      open: row.close,
      high: row.close,
      low: row.close,
      close: row.close,
      volume: null,
    })),
  );
}

/** Fetch ~1y (or plan max) of daily closes for charts + SMAs. Cached ~24h on disk. */
export async function fetchStockHistory(ticker: string): Promise<StockHistory> {
  ensureDisk();
  const id = ticker.trim().toUpperCase();
  const cached = memory.history[id];
  if (cached && isFresh(cached.at)) {
    const clean = sanitizeHistory(cached.value);
    if (clean) {
      if (clean !== cached.value) storeHistory(clean);
      return clean;
    }
  }

  const symbol = marketstackSymbol(id);
  const bars: EodBar[] = [];
  let offset = 0;
  const limit = 1000;
  const dateFrom = yearsAgoIso(5);

  for (let page = 0; page < 3; page++) {
    const json = await marketstackGet<EodResponse>("/eod", {
      symbols: symbol,
      date_from: dateFrom,
      sort: "ASC",
      limit: String(limit),
      offset: String(offset),
    });
    const batch = json.data ?? [];
    for (const row of batch) {
      const close = row.adj_close ?? row.close;
      if (!isValidClose(close) || !row.date) continue;
      bars.push({
        date: toDay(row.date),
        open: isValidClose(row.open) ? row.open : close,
        high: isValidClose(row.high) ? row.high : close,
        low: isValidClose(row.low) ? row.low : close,
        close,
        volume: row.volume ?? null,
      });
    }
    const total = json.pagination?.total ?? bars.length;
    offset += batch.length;
    if (offset >= total || batch.length === 0) break;
  }

  if (!bars.length) {
    throw new Error("No Marketstack bars for " + id);
  }

  const history = buildHistory(id, bars);
  storeHistory(history);
  return history;
}

/** Latest price + day change. Uses history cache first — no extra Marketstack call. */
export async function fetchQuotes(tickers: string[]): Promise<Record<string, StockQuote>> {
  ensureDisk();
  const ids = [...new Set(tickers.map((tk) => tk.trim().toUpperCase()).filter(Boolean))];
  const out: Record<string, StockQuote> = {};
  const missing: string[] = [];

  for (const id of ids) {
    const fromHistory = memory.history[id];
    if (fromHistory && isFresh(fromHistory.at)) {
      out[id] = quoteFromHistory(fromHistory.value);
      continue;
    }
    const cached = memory.quotes[id];
    if (cached && isFresh(cached.at)) {
      out[id] = cached.value;
      continue;
    }
    missing.push(id);
  }

  if (!missing.length) return out;

  // One batched EOD call for all missing tickers (not one call per ticker).
  const symbols = missing.map(marketstackSymbol).join(",");
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 14);
  const recent = await marketstackGet<EodResponse>("/eod", {
    symbols,
    date_from: from.toISOString().slice(0, 10),
    sort: "DESC",
    limit: String(Math.max(40, missing.length * 8)),
  });

  const bySymbol = new Map<string, EodBar[]>();
  for (const row of recent.data ?? []) {
    const close = row.adj_close ?? row.close;
    if (typeof close !== "number" || !row.date || !row.symbol) continue;
    const list = bySymbol.get(row.symbol) ?? [];
    list.push({
      date: toDay(row.date),
      open: row.open ?? close,
      high: row.high ?? close,
      low: row.low ?? close,
      close,
      volume: row.volume ?? null,
    });
    bySymbol.set(row.symbol, list);
  }

  for (const id of missing) {
    const symbol = marketstackSymbol(id);
    const bars = (bySymbol.get(symbol) ?? []).sort((a, b) => b.date.localeCompare(a.date));
    if (!bars.length) {
      out[id] = { ticker: id, price: 0, change: 0, date: "", source: "unavailable" };
      continue;
    }
    const price = bars[0].close;
    const prev = bars[1]?.close ?? price;
    const quote: StockQuote = {
      ticker: id,
      price,
      change: prev ? ((price - prev) / prev) * 100 : 0,
      date: bars[0].date,
      source: "marketstack",
    };
    memory.quotes[id] = { at: Date.now(), value: quote };
    out[id] = quote;
  }

  persistDisk();
  return out;
}
