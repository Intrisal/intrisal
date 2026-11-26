"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  markComingFromAuth,
  resetLandingSkyDecision,
  SKY_PAN_MS,
} from "@/components/landing/intro";
import { Stars } from "@/components/Stars";
import "@/components/landing/landing.css";

/** Shared night-sky shell for /signup and /login — not the product dashboard. */
export function AuthPageShell({
  title,
  children,
  showBack = false,
}: {
  title: string;
  children: ReactNode;
  /** Explicit back control to the landing page. */
  showBack?: boolean;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    resetLandingSkyDecision();
    markComingFromAuth();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setReady(true);
      return;
    }
    const timer = window.setTimeout(() => setReady(true), SKY_PAN_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={"landing auth-page is-sky-pan-right" + (ready ? " is-ready" : "")} data-theme="dark">
      <div className="landing-cosmos" aria-hidden="true">
        <Stars />
        <div className="aurora" />
        <div className="landing-sky" />
      </div>
      <main className="auth-page-inner">
        {showBack ? (
          <Link
            href="/"
            className="auth-page-back-btn"
            onClick={() => {
              resetLandingSkyDecision();
              markComingFromAuth();
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M13 8H3M7 4 3 8l4 4" />
            </svg>
            Back
          </Link>
        ) : (
          <Link
            href="/"
            className="auth-page-back"
            onClick={() => {
              resetLandingSkyDecision();
              markComingFromAuth();
            }}
          >
            Intrisal
          </Link>
        )}
        <h1 className="auth-page-title">{title}</h1>
        {children}
      </main>
    </div>
  );
}
