"use client";

import Link from "next/link";
import { navigateWithCurtain } from "@/lib/routeTransition";
import { useSessionUser } from "@/lib/useSessionUser";

/** Hero CTAs — guests create/sign in; signed-in users open the platform. */
export function LandingHeroActions() {
  const { user, loading } = useSessionUser();

  if (loading) {
    return <div className="landing-hero-actions" aria-hidden="true" style={{ minHeight: 92 }} />;
  }

  if (user) {
    return (
      <div className="landing-hero-actions">
        <button
          type="button"
          className="landing-btn landing-btn-primary"
          onClick={() => void navigateWithCurtain("/home", "to-platform")}
        >
          Open platform
        </button>
        <p className="landing-signed-as">Signed in as {user.name}</p>
      </div>
    );
  }

  return (
    <div className="landing-hero-actions">
      <Link href="/signup" className="landing-btn landing-btn-primary">
        Create account
      </Link>
      <Link href="/login" className="landing-auth-alt">
        Sign in
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
      </Link>
    </div>
  );
}
