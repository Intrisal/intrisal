"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

/** Login panel for the public landing page. */
export function LandingAuth() {
  const [email, setEmail] = useState("");

  function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    // Auth is not wired yet — continue into the product surface.
    window.location.assign("/home");
  }

  return (
    <form className="landing-auth" onSubmit={onSubmit}>
      <div>
        <label htmlFor="landing-email">Email</label>
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
      </div>
      <div className="landing-actions">
        <button type="submit" className="landing-btn landing-btn-primary">
          Sign in
        </button>
        <Link href="/home" className="landing-btn landing-btn-ghost" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>
          Continue to Intrisal
        </Link>
      </div>
    </form>
  );
}
