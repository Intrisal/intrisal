/**
 * Google OAuth helpers for Intrisal accounts (not Supabase Auth).
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const GOOGLE_OAUTH_STATE_COOKIE = "intrisal_oauth_state";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

function authSecret() {
  return process.env.AUTH_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
}

export function appOrigin() {
  const raw =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    "";
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

export function googleOAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      appOrigin() &&
      authSecret(),
  );
}

export function googleRedirectUri() {
  return `${appOrigin()}/api/auth/google/callback`;
}

export function createOAuthState() {
  const nonce = randomBytes(16).toString("hex");
  const secret = authSecret();
  const sig = createHmac("sha256", secret).update(nonce).digest("base64url");
  return `${nonce}.${sig}`;
}

export function verifyOAuthState(state: string) {
  const secret = authSecret();
  if (!secret || !state) return false;
  const [nonce, sig] = state.split(".");
  if (!nonce || !sig) return false;
  const expected = createHmac("sha256", secret).update(nonce).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function googleAuthorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string;
  email_verified: boolean;
};

export async function exchangeGoogleCode(code: string): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) {
    throw new Error("Google sign-in failed. Try again.");
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("Google sign-in failed. Try again.");

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!profileRes.ok) throw new Error("Could not read Google profile.");
  const profile = (await profileRes.json()) as Partial<GoogleProfile>;
  if (!profile.sub || !profile.email) throw new Error("Google did not return an email.");
  return {
    sub: profile.sub,
    email: profile.email,
    name: (profile.name || profile.email.split("@")[0] || "Intrisal user").trim(),
    email_verified: Boolean(profile.email_verified),
  };
}

export function oauthStateCookieOptions(maxAgeSeconds = 600) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
