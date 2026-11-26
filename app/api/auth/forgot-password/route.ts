import { NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/authRateLimit";
import { requestPasswordReset } from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

const FORGOT_IP_LIMIT = { limit: 8, windowMs: 60 * 60 * 1000 } as const;
const FORGOT_EMAIL_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;

export async function POST(request: Request) {
  const ip = clientIp(request);
  const ipLimit = checkRateLimit(`forgot:ip:${ip}`, FORGOT_IP_LIMIT.limit, FORGOT_IP_LIMIT.windowMs);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many reset requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } },
    );
  }

  try {
    const body = (await request.json()) as { email?: string };
    const email = (body.email ?? "").trim().toLowerCase() || "missing";
    const emailLimit = checkRateLimit(
      `forgot:email:${email}`,
      FORGOT_EMAIL_LIMIT.limit,
      FORGOT_EMAIL_LIMIT.windowMs,
    );
    if (!emailLimit.ok) {
      return NextResponse.json(
        { error: "Too many reset requests for this email. Try again later." },
        { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSec) } },
      );
    }

    const result = await requestPasswordReset(body.email ?? "");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start password reset";
    const status = /configured|RESEND|AUTH_URL|missing\. Run/i.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
