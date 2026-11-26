const PREFIX = "intrisal-watchlist:";

function storageKey(userId: string | null | undefined) {
  return PREFIX + (userId || "anon");
}

export function readWatchlist(userId: string | null | undefined): string[] {
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

export function writeWatchlist(userId: string | null | undefined, tickers: string[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(tickers));
  } catch {
    /* ignore quota / private mode */
  }
}
