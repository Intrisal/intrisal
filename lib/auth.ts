/**
 * Intrisal account auth — scrypt password hashes + Google OAuth + signed session cookie.
 * Uses the existing Supabase service role; does not touch platform UI files.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { HEAR_ABOUT_OPTIONS, type HearAbout } from "@/lib/authOptions";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/authSession";
import type { GoogleProfile } from "@/lib/googleOAuth";

export { HEAR_ABOUT_OPTIONS, type HearAbout };

export type AuthProvider = "password" | "google";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  auth_provider: AuthProvider;
  hear_about: HearAbout | null;
  hear_about_other: string | null;
  created_at: string;
};

type StoredUser = AppUser & {
  password_hash: string | null;
  google_sub: string | null;
};

const SCRYPT_KEYLEN = 64;
const USER_SELECT =
  "id,name,email,auth_provider,password_hash,google_sub,hear_about,hear_about_other,created_at";

function authSecret() {
  return process.env.AUTH_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
}

function hasAuthStore() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && authSecret());
}

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
      throw new Error("Auth table is missing. Run supabase/auth-schema.sql in the Supabase SQL editor.");
    }
    if (
      response.status === 409 ||
      detail.includes("23505") ||
      /duplicate key|unique constraint/i.test(detail)
    ) {
      throw new Error("An account with that email already exists");
    }
    throw new Error(`Supabase ${table} HTTP ${response.status}${detail ? ": " + detail.slice(0, 200) : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

function toAppUser(user: StoredUser): AppUser {
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

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const next = scryptSync(password, salt, SCRYPT_KEYLEN);
  const prev = Buffer.from(hash, "hex");
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

export async function createSessionValue(user: Pick<AppUser, "id" | "email" | "name">) {
  return createSessionToken(user);
}

export { SESSION_COOKIE, sessionCookieOptions };
export type { SessionPayload };

export async function findUserByEmail(email: string) {
  const rows = await rest<StoredUser[]>("app_users", {
    email: "eq." + normalizeEmail(email),
    select: USER_SELECT,
    limit: "1",
  });
  return rows[0] ?? null;
}

export async function findUserByGoogleSub(sub: string) {
  const rows = await rest<StoredUser[]>("app_users", {
    google_sub: "eq." + sub,
    select: USER_SELECT,
    limit: "1",
  });
  return rows[0] ?? null;
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  hearAbout: HearAbout;
  hearAboutOther: string | null;
}) {
  if (!hasAuthStore()) throw new Error("Auth storage is not configured");
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email");
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters");
  if (!HEAR_ABOUT_OPTIONS.some((option) => option.value === input.hearAbout)) {
    throw new Error("Tell us how you heard about Intrisal");
  }
  const other = input.hearAbout === "other" ? (input.hearAboutOther ?? "").trim() : null;
  if (input.hearAbout === "other" && !other) {
    throw new Error("Please tell us how you heard about us");
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.auth_provider === "google") {
      throw new Error("This email is already registered with Google. Sign in with Google instead.");
    }
    throw new Error("An account with that email already exists");
  }

  const rows = await rest<StoredUser[]>(
    "app_users",
    { select: USER_SELECT },
    {
      name,
      email,
      auth_provider: "password",
      password_hash: hashPassword(input.password),
      google_sub: null,
      hear_about: input.hearAbout,
      hear_about_other: other,
    },
    "POST",
    "return=representation",
  );
  const user = Array.isArray(rows) ? rows[0] : rows;
  if (!user?.id) throw new Error("Could not create account");
  return toAppUser(user);
}

/**
 * Create or reuse a Google account. Same email cannot also hold a password account.
 */
export async function upsertGoogleUser(profile: GoogleProfile) {
  if (!hasAuthStore()) throw new Error("Auth storage is not configured");
  if (!profile.email_verified) {
    throw new Error("Your Google email must be verified to continue.");
  }

  const email = normalizeEmail(profile.email);
  const name = profile.name.trim() || email.split("@")[0] || "Intrisal user";
  if (!email) throw new Error("Google did not return an email.");

  const bySub = await findUserByGoogleSub(profile.sub);
  if (bySub) return toAppUser(bySub);

  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.auth_provider === "password") {
      throw new Error("An account with that email already exists. Sign in with your password.");
    }
    return toAppUser(existing);
  }

  const rows = await rest<StoredUser[]>(
    "app_users",
    { select: USER_SELECT },
    {
      name,
      email,
      auth_provider: "google",
      password_hash: null,
      google_sub: profile.sub,
      hear_about: null,
      hear_about_other: null,
    },
    "POST",
    "return=representation",
  );
  const user = Array.isArray(rows) ? rows[0] : rows;
  if (!user?.id) throw new Error("Could not create Google account");
  return toAppUser(user);
}

export async function authenticateUser(email: string, password: string) {
  if (!hasAuthStore()) throw new Error("Auth storage is not configured");
  if (!email.trim() || !password) throw new Error("Email and password are required");
  const user = await findUserByEmail(email);
  if (!user) throw new Error("Invalid email or password");
  if (user.auth_provider === "google") {
    throw new Error("This email uses Google sign-in. Continue with Google instead.");
  }
  if (!verifyPassword(password, user.password_hash)) {
    throw new Error("Invalid email or password");
  }
  return toAppUser(user);
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function publicUser(user: AppUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    provider: user.auth_provider,
    hearAbout: user.hear_about,
    hearAboutOther: user.hear_about_other,
  };
}
