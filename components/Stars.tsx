"use client";

import { useEffect, useRef } from "react";

type Rgb = readonly [number, number, number];
type Star = { x: number; y: number; r: number; a: number; fill: string; phase: number; speed: number; depth: number };
type Beacon = { x: number; y: number; half: number; a: number; phase: number; speed: number; sprite: HTMLCanvasElement };

// Warm whites only, taken from the dark palette: cream ink, glass peach, rose and a faint mauve.
const TINTS: readonly Rgb[] = [
  [252, 243, 234],
  [252, 243, 234],
  [248, 228, 210],
  [243, 224, 218],
  [233, 221, 227],
  [241, 208, 178],
];
const HAZE_ROSE: Rgb = [178, 134, 128];
const HAZE_MAUVE: Rgb = [138, 108, 128];
const HAZE_PEACH: Rgb = [240, 206, 182];

const SEED = 0x1a7e5a1; // fixed, so the sky is the same sky on every visit and every resize
const TAU = Math.PI * 2;
const HAZE_ALPHA = 0.125;

// A faint dust lane crossing the sky from lower left to upper right, in viewport fractions.
const BAND = { u: 0.56, v: 0.4, slope: -0.55, sigma: 0.16 };
const BAND_LEN = Math.hypot(1, BAND.slope);
const BAND_NX = -BAND.slope / BAND_LEN;
const BAND_NY = 1 / BAND_LEN;

function bandAt(u: number, v: number, warp = 0) {
  const d = (u - BAND.u) * BAND_NX + (v - BAND.v) * BAND_NY + warp;
  return Math.exp(-(d * d) / (2 * BAND.sigma * BAND.sigma));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(lo: number, hi: number, v: number) {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Seeded fractal value noise, returning roughly 0..1. */
function createFbm(seed: number) {
  const N = 64;
  const rand = mulberry32(seed);
  const grid = new Float32Array(N * N);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const at = (ix: number, iy: number) => grid[(iy & (N - 1)) * N + (ix & (N - 1))];
  const sample = (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = lerp(at(x0, y0), at(x0 + 1, y0), sx);
    const bottom = lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx);
    return lerp(top, bottom, sy);
  };
  return (x: number, y: number, octaves: number) => {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * sample(x * freq + o * 17.3, y * freq + o * 9.7);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  };
}

type PerfProfile = {
  maxDpr: number;
  frameMs: number;
  hazeRes: number;
  starDivisor: number;
  starMax: number;
  beaconDivisor: number;
  beaconMax: number;
  dustDivisor: number;
  dustMax: number;
  twinkle: boolean;
};

/** Pick a cheap-enough sky budget for the device without changing the look on capable screens. */
function readPerfProfile(): PerfProfile {
  const cores = navigator.hardwareConcurrency || 4;
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const lowEnd = saveData || cores <= 4 || (narrow && coarse);

  if (lowEnd) {
    return {
      maxDpr: 1,
      frameMs: 1000 / 12,
      hazeRes: 96,
      starDivisor: 28000,
      starMax: 48,
      beaconDivisor: 420000,
      beaconMax: 4,
      dustDivisor: 9000,
      dustMax: 180,
      twinkle: !saveData,
    };
  }

  return {
    maxDpr: 1.5,
    frameMs: 1000 / 20,
    hazeRes: 140,
    starDivisor: 20000,
    starMax: 90,
    beaconDivisor: 280000,
    beaconMax: 6,
    dustDivisor: 5200,
    dustMax: 320,
    twinkle: true,
  };
}

/** Low-resolution nebula haze: wisps that follow the dust lane, densest along it. */
function buildHaze(w: number, h: number, hazeRes: number) {
  const k = hazeRes / Math.max(w, h);
  const tw = Math.max(32, Math.round(w * k));
  const th = Math.max(32, Math.round(h * k));
  const tex = document.createElement("canvas");
  tex.width = tw;
  tex.height = th;
  const tctx = tex.getContext("2d", { alpha: true });
  if (!tctx) return null;

  const img = tctx.createImageData(tw, th);
  const px = img.data;
  const fbm = createFbm(SEED);
  const dither = mulberry32(SEED + 7);
  const short = Math.min(w, h);
  // Unit vector along the lane in real pixels, so wisps stretch the same way on any aspect ratio.
  const laneLen = Math.hypot(w, BAND.slope * h);
  const tx = w / laneLen;
  const ty = (BAND.slope * h) / laneLen;

  let o = 0;
  for (let j = 0; j < th; j++) {
    const v = (j + 0.5) / th;
    const y = (v * h) / short;
    for (let i = 0; i < tw; i++) {
      const u = (i + 0.5) / tw;
      const x = (u * w) / short;
      const along = x * tx + y * ty;
      const across = y * tx - x * ty;

      const warp = (fbm(along * 1.3 + 31.7, across * 1.3 + 11.3, 1) - 0.5) * 0.3;
      const band = bandAt(u, v, warp);
      const cloud = smoothstep(0.42, 0.82, fbm(along * 1.4, across * 2.8, 2));
      const lane = smoothstep(0.52, 0.7, fbm(along * 2.1 + 53.1, across * 5.4 + 19.9, 2));
      const hue = smoothstep(0.38, 0.62, fbm(along * 0.9 + 87.3, across * 1.3 + 41.7, 1));

      const density = (cloud * (0.16 + 0.84 * band) + 0.14 * band * band) * (1 - 0.55 * lane * band);
      const core = 0.4 * band * band * cloud;
      px[o] = lerp(lerp(HAZE_MAUVE[0], HAZE_ROSE[0], hue), HAZE_PEACH[0], core);
      px[o + 1] = lerp(lerp(HAZE_MAUVE[1], HAZE_ROSE[1], hue), HAZE_PEACH[1], core);
      px[o + 2] = lerp(lerp(HAZE_MAUVE[2], HAZE_ROSE[2], hue), HAZE_PEACH[2], core);
      px[o + 3] = Math.min(255, Math.floor(density * HAZE_ALPHA * 255 + dither()));
      o += 4;
    }
  }
  tctx.putImageData(img, 0, 0);
  return tex;
}

/** A sparse larger star: soft halo, pin-sharp core and, on the biggest, a hairline glint. */
function buildBeaconSprite(r: number, halo: number, tint: Rgb, glint: boolean, dpr: number) {
  const half = Math.ceil(halo * (glint ? 1.5 : 1.05));
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = Math.ceil(half * 2 * dpr);
  const g = sprite.getContext("2d", { alpha: true });
  if (!g) return null;
  const rgba = (a: number) => `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${a})`;
  g.scale(dpr, dpr);
  g.translate(half, half);

  const glow = g.createRadialGradient(0, 0, 0, 0, 0, halo);
  glow.addColorStop(0, rgba(0.3));
  glow.addColorStop(0.16, rgba(0.13));
  glow.addColorStop(0.45, rgba(0.04));
  glow.addColorStop(1, rgba(0));
  g.fillStyle = glow;
  g.fillRect(-half, -half, half * 2, half * 2);

  if (glint) {
    const len = halo * 1.45;
    for (const vertical of [false, true]) {
      const ray = vertical ? g.createLinearGradient(0, -len, 0, len) : g.createLinearGradient(-len, 0, len, 0);
      ray.addColorStop(0, rgba(0));
      ray.addColorStop(0.5, rgba(0.26));
      ray.addColorStop(1, rgba(0));
      g.fillStyle = ray;
      if (vertical) g.fillRect(-0.3, -len, 0.6, len * 2);
      else g.fillRect(-len, -0.3, len * 2, 0.6);
    }
  }

  g.fillStyle = rgba(0.95);
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  return { sprite, half };
}

export function Stars() {
  const deepRef = useRef<HTMLCanvasElement>(null);
  const skyRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const deepEl = deepRef.current;
    const skyEl = skyRef.current;
    const deepContext = deepEl?.getContext("2d", { alpha: true, desynchronized: true });
    const skyContext = skyEl?.getContext("2d", { alpha: true, desynchronized: true });
    if (!deepEl || !skyEl || !deepContext || !skyContext) return;
    // Typed aliases, so the checks above still hold inside the functions below.
    const deep: HTMLCanvasElement = deepEl;
    const sky: HTMLCanvasElement = skyEl;
    const deepCtx: CanvasRenderingContext2D = deepContext;
    const skyCtx: CanvasRenderingContext2D = skyContext;

    const root = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let profile = readPerfProfile();
    let stars: Star[] = [];
    let beacons: Beacon[] = [];
    let dpr = 1;
    let built = "";
    let deepPainted = false;
    let frame = 0;
    let resizeFrame = 0;
    let lastDraw = 0;

    const isDark = () => root.getAttribute("data-theme") === "dark";
    const canAnimate = () => isDark() && !reducedMotion.matches && !document.hidden && profile.twinkle;

    /** Sizes both canvases and lays out the twinkling stars. Returns false when nothing changed. */
    function build() {
      profile = readPerfProfile();
      const w = sky.clientWidth;
      const h = sky.clientHeight;
      const nextDpr = Math.min(window.devicePixelRatio || 1, profile.maxDpr);
      const signature = [w, h, deep.clientWidth, deep.clientHeight, nextDpr, profile.starMax, profile.hazeRes].join("x");
      if (!w || !h || signature === built) return false;
      built = signature;
      dpr = nextDpr;
      deepPainted = false;

      sky.width = Math.round(w * dpr);
      sky.height = Math.round(h * dpr);
      const area = w * h;

      // Mid layer: crisp stars, most of which breathe slowly and out of step with each other.
      let rand = mulberry32(SEED + 2);
      const starCount = clamp(Math.round(area / profile.starDivisor), 18, profile.starMax);
      stars = [];
      for (let i = 0; i < starCount; i++) {
        const u = rand();
        const v = rand();
        const size = rand();
        const tint = TINTS[Math.floor(rand() * TINTS.length)];
        const twinkles = profile.twinkle && rand() < 0.55;
        stars.push({
          x: u * w,
          y: v * h,
          r: 0.45 + Math.pow(size, 2.2) * 0.8,
          a: 0.28 + rand() * 0.42 + (size > 0.9 ? 0.1 : 0),
          fill: `rgb(${tint[0]}, ${tint[1]}, ${tint[2]})`,
          phase: rand() * TAU,
          speed: TAU / (3.6 + rand() * 6.4),
          depth: twinkles ? 0.25 + rand() * 0.45 : 0.06,
        });
      }

      // Near layer: a handful of larger dim stars with a halo, kept apart from each other.
      rand = mulberry32(SEED + 3);
      const beaconCount = clamp(Math.round(area / profile.beaconDivisor), 2, profile.beaconMax);
      const spots: Array<[number, number]> = [];
      beacons = [];
      for (let tries = 0; beacons.length < beaconCount && tries < 120; tries++) {
        const u = 0.05 + rand() * 0.9;
        const v = 0.05 + rand() * 0.9;
        const r = 1 + rand() * 0.55;
        const halo = 7 + rand() * 6;
        const tint = TINTS[Math.floor(rand() * TINTS.length)];
        const a = 0.68 + rand() * 0.26;
        const phase = rand() * TAU;
        const speed = TAU / (7 + rand() * 8);
        if (spots.some(([su, sv]) => Math.hypot(su - u, sv - v) < 0.2)) continue;
        const made = buildBeaconSprite(r, halo, tint, r > 1.3 && profile.maxDpr > 1, dpr);
        if (!made) break;
        spots.push([u, v]);
        beacons.push({ x: u * w, y: v * h, half: made.half, a, phase, speed, sprite: made.sprite });
      }
      return true;
    }

    /** Far layer, painted once per size: nebula haze plus fine dust that gathers along the lane. */
    function paintDeep() {
      const w = deep.clientWidth;
      const h = deep.clientHeight;
      if (!w || !h) return;
      deep.width = Math.round(w * dpr);
      deep.height = Math.round(h * dpr);
      deepCtx.setTransform(1, 0, 0, 1, 0, 0);
      deepCtx.clearRect(0, 0, deep.width, deep.height);

      const haze = buildHaze(w, h, profile.hazeRes);
      if (haze) {
        deepCtx.imageSmoothingEnabled = true;
        deepCtx.imageSmoothingQuality = "low";
        deepCtx.drawImage(haze, 0, 0, deep.width, deep.height);
      }

      deepCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rand = mulberry32(SEED + 1);
      const dustCount = Math.min(profile.dustMax, Math.round((w * h) / profile.dustDivisor));
      for (let placed = 0, tries = 0; placed < dustCount && tries < dustCount * 6; tries++) {
        const u = rand();
        const v = rand();
        const band = bandAt(u, v);
        const keep = rand() < 0.3 + 0.7 * band;
        const size = rand();
        const a = (0.1 + Math.pow(rand(), 2.4) * 0.5) * (0.65 + 0.35 * band);
        const tint = TINTS[Math.floor(rand() * TINTS.length)];
        if (!keep) continue;
        deepCtx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${a.toFixed(3)})`;
        deepCtx.beginPath();
        deepCtx.arc(u * w, v * h, 0.28 + size * size * 0.55, 0, TAU);
        deepCtx.fill();
        placed++;
      }
      deepPainted = true;
    }

    function drawSky(t: number) {
      skyCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      skyCtx.clearRect(0, 0, sky.clientWidth, sky.clientHeight);
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        const dim = st.depth > 0.1 ? 0.5 - 0.5 * Math.cos(t * st.speed + st.phase) : 0;
        skyCtx.globalAlpha = st.a * (1 - st.depth * dim);
        skyCtx.fillStyle = st.fill;
        skyCtx.beginPath();
        skyCtx.arc(st.x, st.y, st.r, 0, TAU);
        skyCtx.fill();
      }
      for (let i = 0; i < beacons.length; i++) {
        const b = beacons[i];
        const dim = profile.twinkle ? 0.5 - 0.5 * Math.cos(t * b.speed + b.phase) : 0;
        skyCtx.globalAlpha = b.a * (1 - 0.3 * dim);
        skyCtx.drawImage(b.sprite, b.x - b.half, b.y - b.half, b.half * 2, b.half * 2);
      }
      skyCtx.globalAlpha = 1;
    }

    function loop(now: number) {
      if (!canAnimate()) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(loop);
      if (now - lastDraw < profile.frameMs) return;
      lastDraw = now;
      drawSky(now / 1000);
    }

    /** Paints what the current theme and motion preference call for, and runs the loop only when needed. */
    function sync() {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!isDark()) return;
      if (!deepPainted) paintDeep();
      if (!canAnimate()) {
        drawSky(0);
        return;
      }
      drawSky(performance.now() / 1000);
      frame = requestAnimationFrame(loop);
    }

    function onResize() {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (build()) sync();
      });
    }

    build();
    sync();
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      <canvas id="stars-deep" ref={deepRef} aria-hidden="true" />
      <canvas id="stars" ref={skyRef} aria-hidden="true" />
    </>
  );
}
