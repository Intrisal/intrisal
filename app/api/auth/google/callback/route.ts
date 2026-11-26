import { NextResponse } from "next/server";
import {
  createSessionValue,
  SESSION_COOKIE,
  sessionCookieOptions,
  upsertGoogleUser,
} from "@/lib/auth";
import { checkRateLimit, clientIp } from "@/lib/authRateLimit";
import {
  appOrigin,
  exchangeGoogleCode,
  GOOGLE_OAUTH_STATE_COOKIE,
  googleOAuthConfigured,
  oauthStateCookieOptions,
  verifyOAuthState,
} from "@/lib/googleOAuth";

export const dynamic = "force-dynamic";

function failRedirect(message: string) {
  const base = appOrigin() || "http://localhost:3000";
  const url = new URL("/login", base);
  url.searchParams.set("error", message);
  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", { ...oauthStateCookieOptions(0), maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  const ip = clientIp(request);
  const limited = checkRateLimit(`google:callback:${ip}`, 30, 15 * 60 * 1000);
  if (!limited.ok) return failRedirect("Too many attempts. Try again later.");

  if (!googleOAuthConfigured()) return failRedirect("Google sign-in is not configured yet.");

  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  if (err) return failRedirect("Google sign-in was cancelled.");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)intrisal_oauth_state=([^;]+)/);
  const cookieState = cookieMatch?.[1] ? decodeURIComponent(cookieMatch[1]) : "";

  if (!code || !state || !cookieState || state !== cookieState || !verifyOAuthState(state)) {
    return failRedirect("Google sign-in could not be verified. Try again.");
  }

  try {
    const profile = await exchangeGoogleCode(code);
    const user = await upsertGoogleUser(profile);
    const base = appOrigin() || url.origin;
    const response = NextResponse.redirect(new URL("/home", base));
    response.cookies.set(SESSION_COOKIE, await createSessionValue(user), sessionCookieOptions());
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", { ...oauthStateCookieOptions(0), maxAge: 0 });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google sign-in failed.";
    return failRedirect(message);
  }
}
