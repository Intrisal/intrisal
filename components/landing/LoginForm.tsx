"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { GoogleAuthButton } from "@/components/landing/GoogleAuthButton";

/** Sign-in form on /login. Sets the session cookie, then opens /home. */
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("created") === "1") {
      setNotice("Account created. Sign in to open Intrisal.");
    } else if (params.get("auth") === "required") {
      setNotice("Sign in to open the Intrisal platform.");
    }
    const oauthError = params.get("error");
    if (oauthError) setError(oauthError);
  }, []);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.statusText);
      window.location.assign("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="landing-auth">
      <form className="landing-auth-card" onSubmit={onSubmit} noValidate>
        <label className="landing-auth-row">
          <span>Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            required
          />
        </label>

        <label className="landing-auth-row">
          <span className="landing-auth-label-row">
            <span>Password</span>
            <Link href="/forgot-password" className="landing-auth-forgot">
              Forgot password?
            </Link>
          </span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            required
          />
        </label>

        {notice ? <p className="landing-auth-notice">{notice}</p> : null}
        {error ? (
          <p className="landing-auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="landing-btn landing-btn-primary landing-auth-submit" disabled={busy}>
          {busy ? "Please wait…" : "Sign in"}
        </button>

        <div className="landing-auth-divider" role="separator" aria-label="or">
          <span>or</span>
        </div>

        <GoogleAuthButton label="Sign in with Google" />
      </form>

      <p className="landing-auth-footnote">
        New to Intrisal?{" "}
        <Link href="/signup" className="landing-auth-switch">
          Create an account
        </Link>
      </p>
      <p className="landing-auth-legal">
        By continuing, you agree to our{" "}
        <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </div>
  );
}
