import { NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/authRateLimit";
import {
  createOAuthState,
  googleAuthorizeUrl,
  googleOAuthConfigured,
  GOOGLE_OAUTH_STATE_COOKIE,
  oauthStateCookieOptions,
} from "@/lib/googleOAuth";

export const dynamic = "force-dynamic";

/** Start Google OAuth — used by both create-account and sign-in. */
export async function GET(request: Request) {
  const ip = clientIp(request);
  const limited = checkRateLimit(`google:start:${ip}`, 20, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.redirect(new URL("/login?error=Too%20many%20attempts.%20Try%20again%20later.", request.url));
  }

  if (!googleOAuthConfigured()) {
    return NextResponse.redirect(
      new URL("/login?error=Google%20sign-in%20is%20not%20configured%20yet.", request.url),
    );
  }

  const state = createOAuthState();
  const intent = new URL(request.url).searchParams.get("intent");
  // Signup may force the account picker; sign-in reuses prior consent with no prompt.
  const authorizeUrl = googleAuthorizeUrl(
    state,
    intent === "signup" ? { prompt: "select_account" } : undefined,
  );
  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, oauthStateCookieOptions());
  return response;
}
