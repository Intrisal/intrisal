// Marketstack is called by the scheduled price worker.
const BASE = "https://api.marketstack.com/v2";

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
  rawClose?: number;
  volume: number | null;
};

export type StockHistory = {
  symbol: string;
  ticker: string;
  dates: string[];
  closes: number[];
  rawCloses?: (number | null)[];
  price: number;
  change: number;
  high52: number;
  low52: number;
  asOf: string;
  source: "marketstack" | "unavailable";
};

export type StockQuote = {
  ticker: string;
  name?: string;
  price: number;
  change: number;
  date: string;
  source: "marketstack" | "unavailable";
};

function apiKey() {
  return process.env.MARKETSTACK_API_KEY?.trim() ?? "";
}

export function marketstackSymbol(ticker: string) {
  const id = ticker.trim().toUpperCase();
  return SYMBOL_MAP[id] ?? id.replace(/\./g, "-");
}

export function hasMarketstackKey() {
  return Boolean(apiKey());
}

export class MarketstackQuotaError extends Error {}

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
    signal: AbortSignal.timeout(6_000),
  });

  if (res.status === 429) throw new MarketstackQuotaError("Marketstack rate or usage limit reached");
  const body = (await res.json()) as T & { error?: { code?: string; message?: string } };
  if (!res.ok || body.error) {
    if (["usage_limit_reached", "rate_limit_reached"].includes(body.error?.code ?? "")) {
      throw new MarketstackQuotaError("Marketstack rate or usage limit reached");
    }
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
    rawCloses: sorted.map((bar) => bar.rawClose ?? null),
    price,
    change,
    high52: year.length ? Math.max(...year) : price,
    low52: year.length ? Math.min(...year) : price,
    asOf: dates[dates.length - 1] ?? "",
    source: "marketstack",
  };
}

/** One request per symbol. Overlap the most recent stored day to capture corrections. */
export async function fetchStockHistory(ticker: string, lastDate?: string): Promise<StockHistory | null> {
  const earliest = yearsAgoIso(1);
  const dateFrom = lastDate && lastDate > earliest ? lastDate : earliest;
  const data = await marketstackGet<EodResponse>("/eod", {
    symbols: marketstackSymbol(ticker),
    date_from: dateFrom,
    sort: "ASC",
    limit: "1000",
  });
  const bars = new Map<string, EodBar>();
  for (const row of data.data ?? []) {
    if (!isValidClose(row.close) || !row.date) continue;
    const date = toDay(row.date);
    const close = isValidClose(row.adj_close) ? row.adj_close : row.close;
    bars.set(date, {
      date, close, rawClose: row.close,
      open: row.open ?? close, high: row.high ?? close, low: row.low ?? close, volume: row.volume ?? null,
    });
  }
  return bars.size ? buildHistory(ticker, [...bars.values()]) : null;
}

/**
 * Batch EOD fetch: up to 100 symbols per Marketstack call so the full S&P 500
 * refreshes in ~6 requests instead of 500+. Returns bars keyed by Intrisal ticker.
 */
export async function fetchBatchLatestEod(
  tickers: string[],
  dateFrom: string,
): Promise<Map<string, EodBar[]>> {
  const byTicker = new Map<string, Map<string, EodBar>>();
  const symbolToTickers = new Map<string, string[]>();
  for (const raw of tickers) {
    const ticker = raw.trim().toUpperCase();
    const sym = marketstackSymbol(ticker).toUpperCase();
    const list = symbolToTickers.get(sym) ?? [];
    list.push(ticker);
    symbolToTickers.set(sym, list);
  }
  const uniqueSymbols = [...symbolToTickers.keys()];
  for (let offset = 0; offset < uniqueSymbols.length; offset += 100) {
    const batch = uniqueSymbols.slice(offset, offset + 100);
    const data = await marketstackGet<EodResponse>("/eod", {
      symbols: batch.join(","),
      date_from: dateFrom,
      sort: "ASC",
      limit: "1000",
    });
    for (const row of data.data ?? []) {
      if (!isValidClose(row.close) || !row.date || !row.symbol) continue;
      const matched = symbolToTickers.get(row.symbol.toUpperCase());
      if (!matched) continue;
      const date = toDay(row.date);
      const close = isValidClose(row.adj_close) ? row.adj_close : row.close;
      const bar: EodBar = {
        date, close, rawClose: row.close,
        open: row.open ?? close, high: row.high ?? close, low: row.low ?? close, volume: row.volume ?? null,
      };
      for (const ticker of matched) {
        let map = byTicker.get(ticker);
        if (!map) {
          map = new Map();
          byTicker.set(ticker, map);
        }
        map.set(date, bar);
      }
    }
  }
  const result = new Map<string, EodBar[]>();
  for (const [ticker, map] of byTicker) {
    result.set(ticker, [...map.values()].sort((a, b) => a.date.localeCompare(b.date)));
  }
  return result;
}
