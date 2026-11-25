"use client";

import { useEffect, useRef } from "react";

type Star = { x: number; y: number; r: number; p: number; s: number };

export function Stars() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let starList: Star[] = [];
    let frame = 0;

    function buildStars() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      starList = [];
      const n = Math.min(170, Math.floor((window.innerWidth * window.innerHeight) / 12000));
      for (let i = 0; i < n; i++) {
        starList.push({
          x: Math.random() * canvas!.width,
          y: Math.random() * canvas!.height,
          r: Math.random() * 1.3 + 0.3,
          p: Math.random() * Math.PI * 2,
          s: 0.4 + Math.random() * 0.9,
        });
      }
    }

    function drawStars() {
      if (document.documentElement.getAttribute("data-theme") !== "dark") return;
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      for (let i = 0; i < starList.length; i++) {
        const st = starList[i];
        ctx!.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(st.p));
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    function tickStars() {
      if (document.documentElement.getAttribute("data-theme") === "dark" && !reducedMotion) {
        for (let i = 0; i < starList.length; i++) starList[i].p += 0.012 * starList[i].s;
        drawStars();
      }
      frame = requestAnimationFrame(tickStars);
    }

    function onResize() {
      buildStars();
      drawStars();
    }

    buildStars();
    drawStars();
    window.addEventListener("resize", onResize);
    frame = requestAnimationFrame(tickStars);
    const observer = new MutationObserver(() => drawStars());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, []);

  return <canvas id="stars" ref={canvasRef} aria-hidden="true" width={1020} height={960} />;
}
