/**
 * Simple sliding-window rate limits for auth endpoints.
 * In-memory (per server instance). Enough to blunt brute-force and spam.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const MAX_KEYS = 5_000;

function prune(now: number) {
  if (buckets.size < MAX_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size < MAX_KEYS) return;
  // Drop oldest half if still oversized (cold start / flood).
  let i = 0;
  for (const key of buckets.keys()) {
    if (i++ % 2 === 0) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  prune(now);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { ok: true };
}

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "unknown";
}

/** Signup: 5 attempts / hour / IP */
export const SIGNUP_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;

/** Login: 20 attempts / 15 min / IP */
export const LOGIN_IP_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 } as const;

/** Login: 8 attempts / 15 min / email */
export const LOGIN_EMAIL_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 } as const;
