"use client";

import { useEffect, useRef, useState } from "react";
import { fmt } from "@/lib/market";

const COUNT_DURATION_MS = 420;

export function useAnimatedNumber(value: number, restartFromZero = false) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    function show(next: number) {
      current.current = next;
      setShown(next);
    }

    function start() {
      cancelAnimationFrame(frame);
      if (motion.matches) {
        show(value);
        return;
      }

      const from = restartFromZero ? 0 : current.current;
      if (from === value) return;
      const startTime = performance.now();
      show(from);

      function tick(now: number) {
        const progress = Math.min((now - startTime) / COUNT_DURATION_MS, 1);
        // Slow slightly as the count reaches the target.
        const eased = progress + 0.35 * progress * (1 - progress);
        show(progress === 1 ? value : from + (value - from) * eased);
        if (progress < 1) frame = requestAnimationFrame(tick);
      }

      frame = requestAnimationFrame(tick);
    }

    start();
    motion.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", start);
    };
  }, [value, restartFromZero]);

  return shown;
}

export function AnimatedPrice({ price }: { price: number }) {
  const shownPrice = useAnimatedNumber(price, true);

  return (
    <span className="animated-number">
      <span className="settled-number">${fmt(price, 2)}</span>
      <span aria-hidden="true">${fmt(shownPrice, 2)}</span>
    </span>
  );
}
