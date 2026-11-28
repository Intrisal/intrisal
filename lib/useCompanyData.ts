"use client";

import { useEffect, useMemo, useState } from "react";
import type { CompanySnapshot } from "@/lib/companyData";

type State = {
  snapshot: CompanySnapshot | null;
  loading: boolean;
  error: string | null;
};

type BatchState = {
  snapshots: Record<string, CompanySnapshot>;
  loading: boolean;
  error: string | null;
};

/** Loads merged Marketstack + EDGAR snapshot (server-cached). */
export function useCompanySnapshot(ticker: string): State {
  const [snapshot, setSnapshot] = useState<CompanySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = ticker.trim().toUpperCase();
    if (!id) {
      setSnapshot(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch("/api/stock/" + encodeURIComponent(id), { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        return body as CompanySnapshot;
      })
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSnapshot(null);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load fundamentals");
      });

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return { snapshot, loading, error };
}

/** Batch load for watchlist / valuation tables. Watchlist reads stored metrics in one request. */
export function useCompanySnapshots(tickers: string[], includeWatchlistMetrics = false): BatchState {
  const key = useMemo(
    () =>
      [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))]
        .sort()
        .join(","),
    [tickers],
  );
  const [snapshots, setSnapshots] = useState<Record<string, CompanySnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!key) {
      setSnapshots({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    async function load() {
      // Watchlist: one stored-metrics request. Other panels: small sequential batches.
      if (includeWatchlistMetrics) {
        try {
          const params = new URLSearchParams({ symbols: key, view: "watchlist" });
          const res = await fetch("/api/fundamentals?" + params, { signal: controller.signal });
          if (!res.ok) throw new Error("Failed to load fundamentals");
          const { snapshots: next } = await res.json() as { snapshots: Record<string, CompanySnapshot> };
          if (!cancelled) {
            setSnapshots(next);
            setLoading(false);
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load fundamentals");
            setLoading(false);
          }
        }
        return;
      }

      const symbols = key.split(",");
      setSnapshots({});
      for (let start = 0; start < symbols.length && !cancelled; start += 4) {
        const batch = symbols.slice(start, start + 4).join(",");
        try {
          const params = new URLSearchParams({ symbols: batch });
          const res = await fetch("/api/fundamentals?" + params, { signal: controller.signal });
          if (!res.ok) throw new Error("Failed to load fundamentals");
          const { snapshots: next } = await res.json() as { snapshots: Record<string, CompanySnapshot> };
          if (!cancelled) setSnapshots((prev) => ({ ...prev, ...next }));
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load fundamentals");
        }
      }
      if (!cancelled) setLoading(false);
    }
    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, includeWatchlistMetrics]);

  return { snapshots, loading, error };
}
