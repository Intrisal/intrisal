/**
 * Browser helpers for account watchlists.
 * Source of truth is Supabase via /api/watchlist; localStorage is only a one-time migrate cache.
 */

const PREFIX = "intrisal-watchlist:";
const MIGRATED_PREFIX = "intrisal-watchlist-migrated:";

function storageKey(userId: string) {
  return PREFIX + userId;
}

function migratedKey(userId: string) {
  return MIGRATED_PREFIX + userId;
}

export function readLocalWatchlist(userId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

export function clearLocalWatchlist(userId: string) {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}

export function hasMigratedLocalWatchlist(userId: string) {
  try {
    return localStorage.getItem(migratedKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function markLocalWatchlistMigrated(userId: string) {
  try {
    localStorage.setItem(migratedKey(userId), "1");
  } catch {
    /* ignore */
  }
}

export async function fetchAccountWatchlist(): Promise<string[]> {
  const response = await fetch("/api/watchlist", { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as { tickers?: string[]; error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.error || "Could not load watchlist");
  }
  return Array.isArray(body?.tickers) ? body.tickers : [];
}

export async function saveAccountWatchlist(tickers: string[]): Promise<string[]> {
  const response = await fetch("/api/watchlist", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers }),
  });
  const body = (await response.json().catch(() => null)) as { tickers?: string[]; error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.error || "Could not save watchlist");
  }
  return Array.isArray(body?.tickers) ? body.tickers : tickers;
}
