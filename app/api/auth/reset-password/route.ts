import { NextResponse } from "next/server";
import {
  createSessionValue,
  publicUser,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";
import { checkRateLimit, clientIp } from "@/lib/authRateLimit";
import { resetPasswordWithToken } from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

const RESET_IP_LIMIT = { limit: 12, windowMs: 60 * 60 * 1000 } as const;

export async function POST(request: Request) {
  const ip = clientIp(request);
  const ipLimit = checkRateLimit(`reset:ip:${ip}`, RESET_IP_LIMIT.limit, RESET_IP_LIMIT.windowMs);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many reset attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } },
    );
  }

  try {
    const body = (await request.json()) as { token?: string; password?: string };
    const user = await resetPasswordWithToken(body.token ?? "", body.password ?? "");
    const response = NextResponse.json({ user: publicUser(user) });
    response.cookies.set(SESSION_COOKIE, await createSessionValue(user), sessionCookieOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reset password";
    const status = /invalid|expired|already been used|missing/i.test(message)
      ? 400
      : /configured|missing\. Run/i.test(message)
        ? 503
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
