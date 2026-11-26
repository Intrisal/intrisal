"use client";

import { useEffect, useState } from "react";

/** Mirrors /api/market/history — kept local so the client never imports the server Marketstack module. */
export type StockHistory = {
  symbol: string;
  ticker: string;
  dates: string[];
  closes: number[];
  price: number;
  change: number;
  high52: number;
  low52: number;
  asOf?: string;
  source: "marketstack" | "unavailable";
};

export type StockQuote = {
  ticker: string;
  price: number;
  change: number;
  date: string;
  source: "marketstack" | "unavailable";
};

type HistoryState = {
  history: StockHistory | null;
  loading: boolean;
  error: string | null;
};

type QuotesState = {
  quotes: Record<string, StockQuote>;
  loading: boolean;
  error: string | null;
};

/** Drop Marketstack glitch bars (close ≤ 0) and recompute 52-week range. */
function sanitizeHistory(history: StockHistory): StockHistory {
  const dates: string[] = [];
  const closes: number[] = [];
  for (let i = 0; i < history.closes.length; i++) {
    const close = history.closes[i];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    dates.push(history.dates[i] ?? "");
    closes.push(close);
  }
  if (closes.length === history.closes.length || closes.length < 2) return history;
  const price = closes[closes.length - 1];
  const prev = closes[closes.length - 2] ?? price;
  const year = closes.slice(-252);
  return {
    ...history,
    dates,
    closes,
    price,
    change: prev ? ((price - prev) / prev) * 100 : history.change,
    high52: Math.max(...year),
    low52: Math.min(...year),
  };
}

/** Live daily history for one ticker (charts, SMAs, 52-week range). */
export function useStockHistory(ticker: string): HistoryState {
  const [history, setHistory] = useState<StockHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = ticker.trim().toUpperCase();
    if (!id) {
      setHistory(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // cache: 'no-store' avoids serving a poisoned browser cache after upstream glitches.
    fetch("/api/market/history?symbol=" + encodeURIComponent(id), { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        return sanitizeHistory(body as StockHistory);
      })
      .then((data) => {
        if (cancelled) return;
        setHistory(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHistory(null);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load market data");
      });

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return { history, loading, error };
}

/** Live quotes for a watchlist / panel of tickers. */
export function useQuotes(tickers: string[]): QuotesState {
  const key = tickers.map((tk) => tk.trim().toUpperCase()).filter(Boolean).sort().join(",");
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [loading, setLoading] = useState(Boolean(key));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!key) {
      setQuotes({});
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // No polling — EOD only needs a refresh about once a day (server disk cache).
    fetch("/api/market/quotes?symbols=" + encodeURIComponent(key))
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        return body.quotes as Record<string, StockQuote>;
      })
      .then((data) => {
        if (cancelled) return;
        setQuotes(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setQuotes({});
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load quotes");
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return { quotes, loading, error };
}
