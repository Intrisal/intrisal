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

const SNAPSHOT_REFRESH_MS = 5 * 60_000;

function recheckWhileVisible(load: () => Promise<void>) {
  function refresh() {
    if (document.visibilityState === "visible") void load();
  }
  const timer = window.setInterval(refresh, SNAPSHOT_REFRESH_MS);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", refresh);
  };
}

/** Loads merged Marketstack + EDGAR data and optionally rechecks an open stock page. */
export function useCompanySnapshot(ticker: string, refreshWhileVisible = false): State {
  const [snapshot, setSnapshot] = useState<CompanySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = ticker.trim().toUpperCase();
    if (!id) {
      setSnapshot(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    let inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch("/api/stock/" + encodeURIComponent(id), {
          cache: "no-store", signal: controller.signal,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        if (controller.signal.aborted) return;
        setSnapshot(body as CompanySnapshot);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setSnapshot((previous) => previous?.ticker === id ? previous : null);
        setError(err instanceof Error ? err.message : "Failed to load fundamentals");
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    const stopRechecking = refreshWhileVisible ? recheckWhileVisible(load) : undefined;
    return () => {
      controller.abort();
      stopRechecking?.();
    };
  }, [ticker, refreshWhileVisible]);

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
    let watchlistInFlight = false;
    async function load() {
      // Watchlist: one stored-metrics request. Other panels: small sequential batches.
      if (includeWatchlistMetrics) {
        if (watchlistInFlight) return;
        watchlistInFlight = true;
        try {
          const params = new URLSearchParams({ symbols: key, view: "watchlist" });
          const res = await fetch("/api/fundamentals?" + params, { signal: controller.signal });
          if (!res.ok) throw new Error("Failed to load fundamentals");
          const { snapshots: next } = await res.json() as { snapshots: Record<string, CompanySnapshot> };
          if (!cancelled) {
            setSnapshots(next);
            setError(null);
            setLoading(false);
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load fundamentals");
            setLoading(false);
          }
        } finally {
          watchlistInFlight = false;
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
    const stopRechecking = includeWatchlistMetrics ? recheckWhileVisible(load) : undefined;

    return () => {
      cancelled = true;
      controller.abort();
      stopRechecking?.();
    };
  }, [key, includeWatchlistMetrics]);

  return { snapshots, loading, error };
}
