"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

/** Request a password-reset email from /forgot-password. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const raw = await res.text();
      let body: { error?: string; message?: string } = {};
      if (raw.trim()) {
        try {
          body = JSON.parse(raw) as { error?: string; message?: string };
        } catch {
          throw new Error(res.ok ? "Unexpected response from server" : "Could not send reset link");
        }
      }
      if (!res.ok) throw new Error(body.error || res.statusText || "Could not send reset link");
      setNotice(body.message || "If an account exists for that email, we sent a reset link.");
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="landing-auth">
      <form className="landing-auth-card" onSubmit={onSubmit} noValidate>
        <p className="landing-auth-lead">
          Enter the email for your Intrisal password account. We will send a link to choose a new password.
        </p>

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

        {notice ? <p className="landing-auth-notice">{notice}</p> : null}
        {error ? (
          <p className="landing-auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="landing-btn landing-btn-primary landing-auth-submit" disabled={busy}>
          {busy ? "Please wait…" : "Send reset link"}
        </button>
      </form>

      <p className="landing-auth-footnote">
        Remembered it?{" "}
        <Link href="/login" className="landing-auth-switch">
          Sign in
        </Link>
      </p>
    </div>
  );
}
