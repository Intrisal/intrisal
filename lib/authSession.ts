/**
 * Edge-safe session token helpers (Web Crypto). Used by proxy and auth APIs.
 */

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  exp: number;
};

export const SESSION_COOKIE = "intrisal_session";
export const SESSION_DAYS = 30;

function authSecret() {
  return process.env.AUTH_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signBody(body: string, secret: string) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return bytesToBase64Url(sig);
}

export async function createSessionToken(user: { id: string; email: string; name: string }) {
  const secret = authSecret();
  if (!secret) throw new Error("AUTH_SECRET (or CRON_SECRET) is required for sessions");
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60,
  };
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await signBody(body, secret);
  return `${body}.${sig}`;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const secret = authSecret();
  if (!secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(sig),
      new TextEncoder().encode(body),
    );
    if (!valid) return null;
    const json = new TextDecoder().decode(base64UrlToBytes(body));
    const payload = JSON.parse(json) as SessionPayload;
    if (!payload?.sub || !payload.email || !payload.exp) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getSessionFromCookieHeader(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)intrisal_session=([^;]+)/);
  if (!match?.[1]) return null;
  try {
    return verifySessionToken(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
