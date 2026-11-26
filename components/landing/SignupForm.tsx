"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { GoogleAuthButton } from "@/components/landing/GoogleAuthButton";
import { HEAR_ABOUT_OPTIONS, type HearAbout } from "@/lib/authOptions";

/** Create-account form on /signup. After success, user must sign in on /login. */
export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hearAbout, setHearAbout] = useState<HearAbout | "">("");
  const [hearAboutOther, setHearAboutOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          hearAbout,
          hearAboutOther: hearAbout === "other" ? hearAboutOther : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.statusText);
      router.replace("/login?created=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="landing-auth">
      <form className="landing-auth-card" onSubmit={onSubmit} noValidate>
        <label className="landing-auth-row">
          <span>
            Name<span className="landing-auth-required" aria-hidden="true">*</span>
          </span>
          <input
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            required
            aria-required="true"
          />
        </label>

        <label className="landing-auth-row">
          <span>
            Email<span className="landing-auth-required" aria-hidden="true">*</span>
          </span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            required
            aria-required="true"
          />
        </label>

        <label className="landing-auth-row">
          <span>
            Password<span className="landing-auth-required" aria-hidden="true">*</span>
          </span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            minLength={8}
            required
            aria-required="true"
          />
        </label>

        <label className="landing-auth-row">
          <span>
            How did you hear about us?<span className="landing-auth-required" aria-hidden="true">*</span>
          </span>
          <select
            name="hearAbout"
            value={hearAbout}
            onChange={(ev) => setHearAbout(ev.target.value as HearAbout | "")}
            required
            aria-required="true"
          >
            <option value="" disabled>
              Select one
            </option>
            {HEAR_ABOUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {hearAbout === "other" ? (
          <label className="landing-auth-row">
            <span>
              Please specify<span className="landing-auth-required" aria-hidden="true">*</span>
            </span>
            <input
              name="hearAboutOther"
              type="text"
              placeholder="Where did you hear about Intrisal?"
              value={hearAboutOther}
              onChange={(ev) => setHearAboutOther(ev.target.value)}
              required
              aria-required="true"
            />
          </label>
        ) : null}

        {error ? (
          <p className="landing-auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="landing-btn landing-btn-primary landing-auth-submit" disabled={busy}>
          {busy ? "Please wait…" : "Create account"}
        </button>

        <div className="landing-auth-divider" role="separator" aria-label="or">
          <span>or</span>
        </div>

        <GoogleAuthButton label="Create account with Google" />
      </form>

      <p className="landing-auth-footnote">
        Already have an account?{" "}
        <Link href="/login" className="landing-auth-switch">
          Sign in
        </Link>
      </p>
      <p className="landing-auth-legal">
        By continuing, you agree to our{" "}
        <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </div>
  );
}
