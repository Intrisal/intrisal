/** Brandfetch Logo CDN helpers — logo renders only (no Brand API / search). */

const CLIENT_ID = process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID ?? "";

export function brandLogoUrl(ticker: string, size = 256): string | null {
  const id = ticker.trim().toUpperCase();
  if (!CLIENT_ID || !id) return null;
  return `https://cdn.brandfetch.io/ticker/${encodeURIComponent(id)}/w/${size}/h/${size}/theme/light/icon.png/fallback/lettermark?c=${encodeURIComponent(CLIENT_ID)}`;
}

export function hasBrandfetchClientId() {
  return Boolean(CLIENT_ID);
}
