"use client";

import { useEffect, useState } from "react";
import { LandingAuth } from "@/components/landing/LandingAuth";
import { LandingDemos } from "@/components/landing/LandingDemos";
import { LandingTopbar } from "@/components/landing/LandingTopbar";
import { LandingShooters } from "@/components/landing/LandingShooters";
import { WordmarkIntro } from "@/components/landing/WordmarkIntro";
import { Stars } from "@/components/Stars";
import "@/components/landing/landing.css";

const INTRO_MS = 1350;

/**
 * Public Intrisal landing — same space theme as the product, fire intro, thesis demos.
 * Product dashboard files stay untouched; app lives at /home.
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
      <WordmarkIntro />
      <div className="landing-scroll">
        <main className="landing-stage">
          <div className="landing-main">
            <p className="landing-brand">Intrisal</p>
            <h2 className="landing-headline">Know if a stock is worth buying — and why.</h2>
            <p className="landing-support">
              Clear buy signals from trend and business quality, for every investor from beginner to advanced. As easy as
              checking the weather.
            </p>
            <LandingAuth />
            <p className="landing-note">SMA trend + company performance, under the same night sky.</p>
          </div>
        </main>
        <LandingDemos />
      </div>
    </div>
  );
}
