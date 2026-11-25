"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/lib/market";

const COUNT_DURATION_MS = 800;

export function AnimatedPrice({ price }: { price: number }) {
  const [shownPrice, setShownPrice] = useState(price);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    function start() {
      cancelAnimationFrame(frame);
      if (motion.matches) {
        setShownPrice(price);
        return;
      }

      const startTime = performance.now();
      setShownPrice(0);

      function tick(now: number) {
        const progress = Math.min((now - startTime) / COUNT_DURATION_MS, 1);
        // Let the price climb steadily and slow a little before it lands.
        const eased = progress + 0.35 * progress * (1 - progress);
        setShownPrice(price * eased);
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
  }, [price]);

  return (
    <span className="animated-price">
      <span className="settled-price">${fmt(price, 2)}</span>
      <span aria-hidden="true">${fmt(shownPrice, 2)}</span>
    </span>
  );
}
