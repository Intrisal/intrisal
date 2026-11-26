"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { LandingClose, LandingDemos } from "@/components/landing/LandingDemos";
import { LandingHeroActions } from "@/components/landing/LandingHeroActions";
import { LandingTopbar } from "@/components/landing/LandingTopbar";
import { LandingShooters } from "@/components/landing/LandingShooters";
import { decideLandingSky, LANDING_INTRO_MS, SKY_PAN_MS } from "@/components/landing/intro";
import { WordmarkIntro } from "@/components/landing/WordmarkIntro";
import { RouteArrive } from "@/components/RouteArrive";
import { Stars } from "@/components/Stars";
import "@/components/landing/landing.css";

type SkyMode = "pending" | "intro" | "pan-left";

/**
 * Public Intrisal landing — the product's night sky, a brand-first hero, then
 * demos sampled from the platform. Product dashboard files stay untouched; app lives at /home.
 */
export function LandingPage() {
  const [ready, setReady] = useState(false);
  const [skyMode, setSkyMode] = useState<SkyMode>("pending");

  useLayoutEffect(() => {
    // Cached decision survives Strict Mode remount — prevents back→twirl.
    setSkyMode(decideLandingSky());
  }, []);

  useEffect(() => {
    if (skyMode === "pending") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setReady(true);
      return;
    }
    const wait = skyMode === "pan-left" ? SKY_PAN_MS : LANDING_INTRO_MS;
    const timer = window.setTimeout(() => setReady(true), wait);
    return () => window.clearTimeout(timer);
  }, [skyMode]);

  const fromAuth = skyMode === "pan-left";

  return (
    <div
      className={
        "landing" +
        (skyMode === "pending" ? " is-sky-hold" : "") +
        (skyMode === "pan-left" ? " is-sky-pan-left" : "") +
        (ready ? " is-ready" : "")
      }
      data-theme="dark"
    >
      <RouteArrive kind="landing" />
      <div className="landing-cosmos" aria-hidden="true" key={skyMode}>
        <Stars />
        <div className="aurora" />
        <div className="landing-sky" />
      </div>
      {skyMode === "intro" ? <LandingShooters /> : null}
      <LandingTopbar />
      <div className="landing-scroll">
        <main>
          <section className="landing-hero" aria-label="Intrisal">
            <div className="landing-hero-inner">
              <WordmarkIntro ready={ready} skipIntro={fromAuth} />
              <div className="landing-hero-rest">
                <h2 className="landing-headline">Know if a stock is worth buying — and why.</h2>
                <p className="landing-support">
                  One clear signal for every stock, with the trend, fundamentals and valuation behind it.
                </p>
                <LandingHeroActions />
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
