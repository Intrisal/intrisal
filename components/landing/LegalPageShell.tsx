"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Stars } from "@/components/Stars";
import "@/components/landing/landing.css";

/** Public legal document shell — landing sky, not the product dashboard. */
export function LegalPageShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="landing legal-page is-ready" data-theme="dark">
      <div className="landing-cosmos" aria-hidden="true">
        <Stars />
        <div className="aurora" />
        <div className="landing-sky" />
      </div>
      <main className="legal-page-inner">
        <Link href="/" className="auth-page-back-btn">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13 8H3M7 4 3 8l4 4" />
          </svg>
          Back
        </Link>
        <header className="legal-page-header">
          <p className="legal-page-kicker">Intrisal</p>
          <h1 className="legal-page-title">{title}</h1>
          <p className="legal-page-updated">Last updated: {updated}</p>
        </header>
        <article className="legal-prose">{children}</article>
        <nav className="legal-page-nav" aria-label="Legal">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/">Landing</Link>
        </nav>
      </main>
    </div>
  );
}
