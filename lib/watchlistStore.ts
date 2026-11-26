/**
 * Server-side account watchlists in Supabase (service role).
 */

const MAX_TICKERS = 100;

export function normalizeWatchlist(tickers: unknown): string[] {
  if (!Array.isArray(tickers)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of tickers) {
    if (typeof item !== "string") continue;
    const ticker = item.trim().toUpperCase();
    if (!ticker || !/^[A-Z0-9.$-]{1,12}$/.test(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    next.push(ticker);
    if (next.length >= MAX_TICKERS) break;
  }
  return next;
}

async function rest<T>(
  query: Record<string, string>,
  rows?: object | object[],
  method = rows ? "POST" : "GET",
  prefer = "return=representation",
): Promise<T> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Supabase credentials are missing");
  const url = new URL("/rest/v1/user_watchlists", base);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "User-Agent": "Intrisal-server/1.0",
      ...(rows ? { "Content-Type": "application/json", Prefer: prefer } : {}),
    },
    body: rows ? JSON.stringify(rows) : undefined,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 404 || detail.includes("PGRST205")) {
      throw new Error("Watchlist table is missing. Run supabase/watchlist-schema.sql in the Supabase SQL editor.");
    }
    throw new Error(`Supabase user_watchlists HTTP ${response.status}${detail ? ": " + detail.slice(0, 200) : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function readUserWatchlist(userId: string): Promise<string[]> {
  const rows = await rest<{ tickers: string[] | null }[]>({
    user_id: "eq." + userId,
    select: "tickers",
    limit: "1",
  });
  return normalizeWatchlist(rows[0]?.tickers ?? []);
}

export async function writeUserWatchlist(userId: string, tickers: string[]): Promise<string[]> {
  const normalized = normalizeWatchlist(tickers);
  await rest(
    { on_conflict: "user_id" },
    {
      user_id: userId,
      tickers: normalized,
      updated_at: new Date().toISOString(),
    },
    "POST",
    "resolution=merge-duplicates,return=minimal",
  );
  return normalized;
}
