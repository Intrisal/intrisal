/** Brandfetch Logo CDN helpers — logo renders only (no Brand API / search). */

const CLIENT_ID = process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID ?? "";

type LogoKind = "icon" | "symbol";
type Fallback = "lettermark" | "404";

/**
 * Logo CDN URL by ticker.
 * `icon` = filled brand tile (background + mark). `symbol` = mark only when available.
 */
export function brandLogoUrl(
  ticker: string,
  size = 256,
  kind: LogoKind = "icon",
  fallback: Fallback = "lettermark",
): string | null {
  if (!CLIENT_ID || !ticker) return null;
  const id = encodeURIComponent(ticker.trim().toUpperCase());
  return `https://cdn.brandfetch.io/ticker/${id}/w/${size}/h/${size}/theme/light/${kind}.png/fallback/${fallback}?c=${encodeURIComponent(CLIENT_ID)}`;
}

export function hasBrandfetchClientId() {
  return Boolean(CLIENT_ID);
}
