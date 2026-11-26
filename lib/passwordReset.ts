/**
 * Password reset tokens + password update (service role).
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  findUserByEmail,
  hashPassword,
  normalizeEmail,
  type AppUser,
} from "@/lib/auth";
import { appOrigin } from "@/lib/googleOAuth";
import {
  googleAccountReminderEmail,
  mailConfigured,
  passwordResetEmail,
  sendEmail,
} from "@/lib/mail";

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 60 * 60 * 1000;

type TokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
};

async function rest<T>(
  table: string,
  query: Record<string, string>,
  rows?: object | object[],
  method = rows ? "POST" : "GET",
  prefer = "return=representation",
): Promise<T> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Supabase credentials are missing");
  const url = new URL("/rest/v1/" + table, base);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "User-Agent": "Intrisal-server/1.0",
      ...(rows ? { "Content-Type": "application/json", Prefer: prefer } : {}),
    },
    body: rows ? JSON.stringify(rows) : undefined,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 404 || detail.includes("PGRST205")) {
      throw new Error(
        "Password reset table is missing. Run supabase/password-reset-schema.sql in the Supabase SQL editor.",
      );
    }
    throw new Error(
      `Supabase ${table} HTTP ${response.status}${detail ? ": " + detail.slice(0, 200) : ""}`,
    );
  }
  // PostgREST often returns 201/200 with an empty body when Prefer: return=minimal.
  if (response.status === 204 || (rows && prefer.includes("return=minimal"))) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createRawToken() {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

async function invalidateOpenTokens(userId: string) {
  await rest(
    "password_reset_tokens",
    {
      user_id: "eq." + userId,
      used_at: "is.null",
    },
    { used_at: new Date().toISOString() },
    "PATCH",
    "return=minimal",
  );
}

async function updatePasswordHash(userId: string, passwordHash: string) {
  await rest(
    "app_users",
    { id: "eq." + userId },
    { password_hash: passwordHash },
    "PATCH",
    "return=minimal",
  );
}

/**
 * Always resolves with a generic message. Sends mail only when appropriate.
 */
export async function requestPasswordReset(emailInput: string): Promise<{ message: string }> {
  const message =
    "If an Intrisal password account exists for that email, we sent a reset link. Check your inbox.";

  if (!mailConfigured()) {
    throw new Error("Password reset email is not configured yet. Set RESEND_API_KEY, EMAIL_FROM, and AUTH_URL.");
  }

  const email = normalizeEmail(emailInput);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email");
  }

  const origin = appOrigin();
  if (!origin) throw new Error("AUTH_URL is not configured");

  const user = await findUserByEmail(email);
  if (!user) return { message };

  if (user.auth_provider === "google") {
    const content = googleAccountReminderEmail({
      name: user.name,
      loginUrl: `${origin}/login`,
    });
    await sendEmail({ to: user.email, ...content });
    return { message };
  }

  const rawToken = createRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  await invalidateOpenTokens(user.id);
  await rest(
    "password_reset_tokens",
    { select: "id" },
    {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    },
    "POST",
    "return=minimal",
  );

  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const content = passwordResetEmail({ name: user.name, resetUrl });
  await sendEmail({ to: user.email, ...content });
  return { message };
}

export async function resetPasswordWithToken(token: string, password: string): Promise<AppUser> {
  if (!token?.trim()) throw new Error("Reset link is missing or invalid");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");

  const tokenHash = hashToken(token.trim());
  const rows = await rest<TokenRow[]>("password_reset_tokens", {
    token_hash: "eq." + tokenHash,
    select: "id,user_id,token_hash,expires_at,used_at",
    limit: "1",
  });
  const row = rows[0];
  if (!row || row.used_at) throw new Error("This reset link is invalid or has already been used");
  if (Date.parse(row.expires_at) <= Date.now()) {
    throw new Error("This reset link has expired. Request a new one.");
  }

  // Constant-time compare on stored hash vs recomputed (defense in depth).
  try {
    const a = Buffer.from(row.token_hash);
    const b = Buffer.from(tokenHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("This reset link is invalid or has already been used");
    }
  } catch {
    throw new Error("This reset link is invalid or has already been used");
  }

  await updatePasswordHash(row.user_id, hashPassword(password));
  await rest(
    "password_reset_tokens",
    { id: "eq." + row.id },
    { used_at: new Date().toISOString() },
    "PATCH",
    "return=minimal",
  );
  await invalidateOpenTokens(row.user_id);

  const users = await rest<
    { id: string; name: string; email: string; auth_provider: "password" | "google"; hear_about: null; hear_about_other: null; created_at: string }[]
  >("app_users", {
    id: "eq." + row.user_id,
    select: "id,name,email,auth_provider,hear_about,hear_about_other,created_at",
    limit: "1",
  });
  const user = users[0];
  if (!user) throw new Error("Account not found");
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    auth_provider: user.auth_provider,
    hear_about: user.hear_about,
    hear_about_other: user.hear_about_other,
    created_at: user.created_at,
  };
}
