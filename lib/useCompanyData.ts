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

/** Batch load for watchlist valuation tables (sequential on server, cached). */
export function useCompanySnapshots(tickers: string[]): BatchState {
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

    fetch("/api/fundamentals?symbols=" + encodeURIComponent(key), { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        return body as { snapshots: Record<string, CompanySnapshot> };
      })
      .then((data) => {
        if (cancelled) return;
        setSnapshots(data.snapshots ?? {});
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSnapshots({});
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load fundamentals");
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return { snapshots, loading, error };
}
