"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

/** Hero call to action: one email field with its button, and a quiet way straight in. */
export function LandingAuth() {
  const [email, setEmail] = useState("");

  function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    // Auth is not wired yet — continue into the product surface.
    window.location.assign("/home");
  }

  return (
    <div className="landing-auth">
      <form className="landing-auth-field" onSubmit={onSubmit}>
        <label className="landing-sr" htmlFor="landing-email">
          Email
        </label>
        <input
          id="landing-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          required
        />
        <button type="submit" className="landing-btn landing-btn-primary">
          Sign in
        </button>
      </form>
      <Link href="/home" className="landing-auth-alt">
        Continue to Intrisal
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
      </Link>
    </div>
  );
}
