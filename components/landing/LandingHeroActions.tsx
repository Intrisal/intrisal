import Link from "next/link";

/** Hero CTAs — separate /signup and /login pages hold the actual forms. */
export function LandingHeroActions() {
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
