"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const LETTERS = ["I", "n", "t", "r", "i", "s", "a", "l"] as const;
/**
 * Settled brand is a quiet signature; intro scales up from that so the morph
 * still feels cinematic without ending as a billboard.
 */
const INTRO_SCALE = 1.55;
/** Cap parked width so the mark never fills the screen edge-to-edge. */
const INTRO_FILL = 0.82;
/** Keep a clear shrink on narrow phones. */
const INTRO_SCALE_MIN = 1.18;
const SETTLE_MS = 950;

type WordmarkIntroProps = {
  ready: boolean;
  /** Returning from auth — keep the mark in its settled slot (no hard jump). */
  skipIntro?: boolean;
};

/**
 * Single Intrisal wordmark: starts centered & large, then eases into its
 * in-flow hero slot. Same DOM node the whole time — no handoff flash.
 */
export function WordmarkIntro({ ready, skipIntro = false }: WordmarkIntroProps) {
  const markRef = useRef<HTMLHeadingElement>(null);
  const startRef = useRef<{ dx: number; dy: number; scale: number } | null>(null);
  const skipIntroRef = useRef(skipIntro);
  const [prepared, setPrepared] = useState(false);
  skipIntroRef.current = skipIntro;

  // Before paint: park the brand at viewport center, scaled up.
  // Depends on skipIntro so pending→intro can still park after the hold frame.
  useLayoutEffect(() => {
    const mark = markRef.current;
    if (!mark) return;

    if (skipIntroRef.current) {
      mark.style.transition = "none";
      mark.style.transform = "none";
      startRef.current = null;
      setPrepared(true);
      return;
    }

    // When ready flips, do NOT clear the parked transform here.
    // Clearing it caused the choppy snap; the settle effect owns the handoff.
    if (ready) {
      setPrepared(true);
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      mark.style.transition = "none";
      mark.style.transform = "none";
      startRef.current = null;
      setPrepared(true);
      return;
    }

    mark.style.transition = "none";
    mark.style.transform = "none";
    void mark.offsetWidth;

    const rect = mark.getBoundingClientRect();
    const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
    const dy = window.innerHeight / 2 - (rect.top + rect.height / 2);
    // The settled hero brand is already wide, so cap the intro size to the viewport.
    const fit = rect.width > 0 ? (window.innerWidth * INTRO_FILL) / rect.width : INTRO_SCALE;
    const scale = Math.max(INTRO_SCALE_MIN, Math.min(INTRO_SCALE, fit));
    startRef.current = { dx, dy, scale };
    mark.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
    setPrepared(true);
  }, [ready, skipIntro]);

  // When intro finishes: ease back to the natural layout slot.
  useEffect(() => {
    const mark = markRef.current;
    if (!mark || !ready || skipIntroRef.current) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = startRef.current;
    if (reduced || !start) {
      mark.style.transition = "none";
      mark.style.transform = "none";
      return;
    }

    // Re-assert the parked pose (no transition), then tween to the hero slot.
    mark.style.transition = "none";
    mark.style.transform = `translate3d(${start.dx}px, ${start.dy}px, 0) scale(${start.scale})`;
    void mark.offsetWidth;

    let raf2 = 0;
    let settleTimer = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        mark.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        mark.style.transform = "translate3d(0, 0, 0) scale(1)";
        settleTimer = window.setTimeout(() => {
          mark.style.transition = "";
          startRef.current = null;
        }, SETTLE_MS + 40);
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [ready]);

  return (
    <>
      <div className={"landing-intro-bloom" + (ready ? " is-settling" : "")} aria-hidden="true" />
      <h1
        className={
          "landing-brand" +
          (prepared ? " is-prepared" : "") +
          (ready || skipIntro ? " is-settling" : " is-intro")
        }
        ref={markRef}
        aria-label="Intrisal"
      >
        {LETTERS.map((letter, index) => (
          <span key={`${letter}-${index}`} style={{ ["--i" as string]: index }} aria-hidden="true">
            {letter}
          </span>
        ))}
      </h1>
    </>
  );
}
