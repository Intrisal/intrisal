"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

/** Set a new password from /reset-password?token=… */
export function ResetPasswordForm() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("token")?.trim() || "";
    setToken(next);
    if (!next) setError("This reset link is missing or incomplete. Request a new one.");
  }, []);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (!token) {
      setError("This reset link is missing or incomplete. Request a new one.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
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
        <p className="landing-auth-lead">Choose a new password for your Intrisal account.</p>

        <label className="landing-auth-row">
          <span>New password</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            minLength={8}
            required
          />
        </label>

        <label className="landing-auth-row">
          <span>Confirm password</span>
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter password"
            value={confirm}
            onChange={(ev) => setConfirm(ev.target.value)}
            minLength={8}
            required
          />
        </label>

        {error ? (
          <p className="landing-auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="landing-btn landing-btn-primary landing-auth-submit"
          disabled={busy || !token}
        >
          {busy ? "Please wait…" : "Update password"}
        </button>
      </form>

      <p className="landing-auth-footnote">
        Link expired?{" "}
        <Link href="/forgot-password" className="landing-auth-switch">
          Request a new one
        </Link>
      </p>
    </div>
  );
}
