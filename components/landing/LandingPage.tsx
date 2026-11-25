"use client";

import { useEffect, useState } from "react";
import { LandingAuth } from "@/components/landing/LandingAuth";
import { LandingClose, LandingDemos } from "@/components/landing/LandingDemos";
import { LandingTopbar } from "@/components/landing/LandingTopbar";
import { LandingShooters } from "@/components/landing/LandingShooters";
import { WordmarkIntro } from "@/components/landing/WordmarkIntro";
import { Stars } from "@/components/Stars";
import "@/components/landing/landing.css";

const INTRO_MS = 1350;

/**
 * Public Intrisal landing — the product's night sky, a brand-first hero, then
 * demos sampled from the platform. Product dashboard files stay untouched; app lives at /home.
 */
export function LandingPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setReady(true);
      return;
    }
    const timer = window.setTimeout(() => setReady(true), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={"landing" + (ready ? " is-ready" : "")} data-theme="dark">
      <div className="landing-cosmos" aria-hidden="true">
        <Stars />
        <div className="aurora" />
        <div className="landing-sky" />
      </div>
      <LandingShooters />
      <LandingTopbar />
      <div className="landing-scroll">
        <main>
          <section className="landing-hero" aria-label="Intrisal">
            <div className="landing-hero-inner">
              <WordmarkIntro ready={ready} />
              <div className="landing-hero-rest">
                <h2 className="landing-headline">Know if a stock is worth buying — and why.</h2>
                <p className="landing-support">
                  One clear signal for every stock, with the trend, fundamentals and valuation behind it.
                </p>
                <LandingAuth />
              </div>
            </div>
            <a className="landing-scroll-cue" href="#graph-analysis">
              <span>See it work</span>
              <i aria-hidden="true" />
            </a>
          </section>
          <LandingDemos />
        </main>
        <LandingClose />
      </div>
    </div>
  );
}
