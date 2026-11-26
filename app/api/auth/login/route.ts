import { NextResponse } from "next/server";
import {
  authenticateUser,
  createSessionValue,
  normalizeEmail,
  publicUser,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";
import {
  checkRateLimit,
  clientIp,
  LOGIN_EMAIL_LIMIT,
  LOGIN_IP_LIMIT,
} from "@/lib/authRateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const ipLimit = checkRateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT.limit, LOGIN_IP_LIMIT.windowMs);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } },
    );
  }

  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const emailKey = normalizeEmail(body.email ?? "") || "missing";
    const emailLimit = checkRateLimit(
      `login:email:${emailKey}`,
      LOGIN_EMAIL_LIMIT.limit,
      LOGIN_EMAIL_LIMIT.windowMs,
    );
    if (!emailLimit.ok) {
      return NextResponse.json(
        { error: "Too many sign-in attempts for this email. Try again later." },
        { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSec) } },
      );
    }

    const user = await authenticateUser(body.email ?? "", body.password ?? "");
    const response = NextResponse.json({ user: publicUser(user) });
    response.cookies.set(SESSION_COOKIE, await createSessionValue(user), sessionCookieOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sign in";
    const status = /invalid email or password/i.test(message)
      ? 401
      : /Google sign-in/i.test(message)
        ? 400
        : /configured/i.test(message)
          ? 503
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
