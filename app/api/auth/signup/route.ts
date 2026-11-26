import { NextResponse } from "next/server";
import { createUser, publicUser, type HearAbout } from "@/lib/auth";
import { checkRateLimit, clientIp, SIGNUP_LIMIT } from "@/lib/authRateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = checkRateLimit(`signup:ip:${ip}`, SIGNUP_LIMIT.limit, SIGNUP_LIMIT.windowMs);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many signup attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  try {
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
      hearAbout?: HearAbout;
      hearAboutOther?: string;
    };

    const user = await createUser({
      name: body.name ?? "",
      email: body.email ?? "",
      password: body.password ?? "",
      hearAbout: body.hearAbout as HearAbout,
      hearAboutOther: body.hearAboutOther ?? null,
    });

    // Account only — user must sign in on /login before entering the platform.
    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create account";
    const status = /already exists|registered with Google/i.test(message)
      ? 409
      : /required|valid|characters|heard|Tell us/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
