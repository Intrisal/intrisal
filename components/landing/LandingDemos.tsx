"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import {
  CHART_TICKERS,
  DEMO_STOCKS,
  SIGNAL_REASON,
  demoStock,
  formatPercent,
  formatPrice,
  type DemoSignal,
  type DemoStock,
} from "@/components/landing/demoData";
import { navigateWithCurtain } from "@/lib/routeTransition";
import { useSessionUser } from "@/lib/useSessionUser";

type Size = { w: number; h: number };

const RANGES = [
  ["3M", 63],
  ["6M", 126],
  ["1Y", 252],
] as const;
type RangeKey = (typeof RANGES)[number][0];

/** Top to bottom on the reading sketch: the lower the price sits against its averages, the stronger the signal. */
const READINGS: readonly DemoSignal[] = ["Hold", "Buy", "Strong Buy"];
const READING_MS = 3800;

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/** True once the element has scrolled into view (and, unless `once` is false, stays true). */
function useInView<T extends Element>(threshold: number, once = true) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, once]);

  return [ref, inView] as const;
}

/** Tracks an element's pixel box so SVG demos can draw 1:1 — crisp strokes and text at any width. */
function useBoxSize<T extends Element>(initial: Size) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(initial);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const apply = () => {
      const w = Math.round(node.clientWidth);
      const h = Math.round(node.clientHeight);
      if (!w || !h) return;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function Coin({ ticker }: { ticker: string }) {
  return (
    <span className="landing-coin" aria-hidden="true">
      <BrandLogo tk={ticker} />
    </span>
  );
}

const signalTone = (signal: DemoSignal) => (signal === "Hold" ? "neutral" : "positive");

/* ---------- Graph Analysis ---------- */

function PriceChart({ stock, days, size, drawKey }: { stock: DemoStock; days: number; size: Size; drawKey: string }) {
  const maskId = "landing-mask-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const compact = size.w < 560;
  const left = compact ? 46 : 62;
  const right = size.w - (compact ? 14 : 22);
  const top = 14;
  const bottom = size.h - (compact ? 28 : 34);

  const lines = [stock.closes, stock.shortSma, stock.longSma].map((line) => line.slice(-days));
  const values = lines.flat();
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = (high - low) * 0.08 || 1;
  const max = high + padding;
  const min = Math.max(0, low - padding);
  const xAt = (progress: number) => left + progress * (right - left);
  const yAt = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const [closePoints, shortPoints, longPoints] = lines.map((line) =>
    line.map((value, i) => `${xAt(i / (line.length - 1)).toFixed(1)},${yAt(value).toFixed(1)}`).join(" "),
  );
  const tipY = yAt(lines[0][lines[0].length - 1]);
  const timeTicks = compact ? [0, 2, 4] : [0, 1, 2, 3, 4];

  return (
    <svg
      className="landing-chart"
      viewBox={`0 0 ${size.w} ${size.h}`}
      role="img"
      aria-label={stock.ticker + " sample closing prices with 50-day and 200-day moving averages"}
    >
      {[0, 1, 2, 3, 4].map((tick) => {
        const value = max - ((max - min) * tick) / 4;
        const y = yAt(value);
        return (
          <g key={tick}>
            <line x1={left} x2={right} y1={y} y2={y} />
            <text x={left - 10} y={y} textAnchor="end" dominantBaseline="middle">
              ${Math.round(value).toLocaleString("en-US")}
            </text>
          </g>
        );
      })}
      {timeTicks.map((tick) => (
        <text key={tick} x={xAt(tick / 4)} y={size.h - 6} textAnchor={tick === 4 ? "end" : tick === 0 ? "start" : "middle"}>
          {tick === 4 ? "Latest" : `${Math.round((days - 1) * (1 - tick / 4))}d ago`}
        </text>
      ))}
      {/* Keyed so a new stock or range remounts the lines and they draw in again. */}
      <g key={drawKey}>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={size.w} height={size.h}>
          <polyline className="landing-draw landing-chart-reveal" points={longPoints} pathLength={1} />
        </mask>
        <polyline className="landing-chart-long" points={longPoints} mask={`url(#${maskId})`} />
        <polyline className="landing-draw landing-chart-short" points={shortPoints} pathLength={1} />
        <polyline className="landing-draw landing-chart-close" points={closePoints} pathLength={1} />
        <g className="landing-tip" transform={`translate(${right.toFixed(1)} ${tipY.toFixed(1)})`}>
          <circle className="landing-tip-ring" r={5} />
          <circle className="landing-tip-dot" r={4} />
        </g>
      </g>
    </svg>
  );
}

function GraphDemo() {
  const [frameRef, inView] = useInView<HTMLDivElement>(0.2);
  const [plotRef, size] = useBoxSize<HTMLDivElement>({ w: 960, h: 420 });
  const [ticker, setTicker] = useState<string>(CHART_TICKERS[0]);
  const [range, setRange] = useState<RangeKey>("1Y");
  const [redrawn, setRedrawn] = useState(false);

  const stock = demoStock(ticker);
  const days = RANGES.find(([key]) => key === range)?.[1] ?? 252;
  const drawKey = ticker + ":" + range;
  const tone = signalTone(stock.signal);

  return (
    <div
      className={"landing-graph landing-reveal" + (inView ? " is-inview" : "")}
      ref={frameRef}
      data-redrawn={redrawn ? "true" : undefined}
    >
      <div
        className="landing-switch"
        role="group"
        aria-label="Sample stock"
        style={cssVars({ "--index": CHART_TICKERS.indexOf(ticker as (typeof CHART_TICKERS)[number]) })}
      >
        {CHART_TICKERS.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={item === ticker}
            onClick={() => {
              if (item === ticker) return;
              setTicker(item);
              setRedrawn(true);
            }}
          >
            {item}
          </button>
        ))}
      </div>

      <article className="landing-window" aria-label={stock.ticker + " graph analysis sample"}>
        <header className="landing-window-head">
          <div className="landing-ident">
            <Coin ticker={stock.ticker} />
            <div>
              <strong>{stock.ticker}</strong>
              <span className="landing-ident-name">
                {stock.name} · {stock.exchange}
              </span>
            </div>
          </div>
          <div className="landing-ranges" role="group" aria-label="Chart range">
            {RANGES.map(([key]) => (
              <button
                type="button"
                key={key}
                aria-pressed={key === range}
                onClick={() => {
                  if (key === range) return;
                  setRange(key);
                  setRedrawn(true);
                }}
              >
                {key}
              </button>
            ))}
          </div>
        </header>

        <div className="landing-plot" ref={plotRef}>
          <PriceChart stock={stock} days={days} size={size} drawKey={drawKey} />
        </div>

        <div className="landing-legend-row">
          <ul className="landing-legend" aria-label="Chart legend">
            <li className="landing-legend-close">Closing price</li>
            <li className="landing-legend-short">50-day SMA</li>
            <li className="landing-legend-long">200-day SMA</li>
          </ul>
          <span className="landing-sample-note">Sample data</span>
        </div>

        <dl className="landing-strip" aria-label="Latest sample snapshot">
          <div className="landing-strip-signal">
            <dt>Signal</dt>
            <dd>
              <span key={drawKey} className="landing-signal" data-tone={tone}>
                {stock.signal}
              </span>
            </dd>
            <dd className="landing-caption">{stock.reason}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd className="landing-figure">${formatPrice(stock.price)}</dd>
            <dd className="landing-caption">Sample closing price</dd>
          </div>
          <div>
            <dt>1Y return</dt>
            <dd className="landing-figure" data-tone={stock.yearReturn >= 0 ? "positive" : "negative"}>
              {formatPercent(stock.yearReturn)}
            </dd>
            <dd className="landing-caption">252 sessions</dd>
          </div>
          <div className="landing-strip-range">
            <dt>52-Week Range</dt>
            <dd>
              <div className="landing-range-track" aria-hidden="true">
                <span style={{ left: stock.position.toFixed(1) + "%" }} />
              </div>
              <div className="landing-range-labels">
                <span>${formatPrice(stock.low)}</span>
                <span>${formatPrice(stock.high)}</span>
              </div>
            </dd>
          </div>
        </dl>
      </article>
    </div>
  );
}

/* ---------- Watchlist ---------- */

function Sparkline({ values }: { values: number[] }) {
  const width = 104;
  const height = 30;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const points = values
    .map((value, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 3 - ((value - low) / span) * (height - 6)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="landing-spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline className="landing-draw" points={points} pathLength={1} />
    </svg>
  );
}

function WatchDemo() {
  const [frameRef, inView] = useInView<HTMLDivElement>(0.25);
  const [selected, setSelected] = useState(DEMO_STOCKS[0].ticker);
  // Three months of closes, thinned so the row sparkline stays light.
  const sparks = useMemo(
    () => DEMO_STOCKS.map((stock) => stock.closes.slice(-63).filter((_, i) => i % 3 === 0)),
    [],
  );

  return (
    <div className={"landing-watch landing-reveal" + (inView ? " is-inview" : "")} ref={frameRef}>
      <div className="landing-dock" role="group" aria-label="Stock shortcuts">
        {DEMO_STOCKS.map((stock, index) => (
          <button
            type="button"
            key={stock.ticker}
            className="landing-chip"
            aria-pressed={stock.ticker === selected}
            aria-label={stock.ticker + ", " + formatPercent(stock.change) + " today"}
            style={cssVars({ "--d": index })}
            onClick={() => setSelected(stock.ticker)}
          >
            <Coin ticker={stock.ticker} />
            <span className="landing-chip-ticker">{stock.ticker}</span>
            <span className="landing-chip-chg" data-dir={stock.change >= 0 ? "up" : "down"}>
              {formatPercent(stock.change)}
            </span>
          </button>
        ))}
      </div>

      <ul className="landing-rows" aria-label="Watchlist sample">
        {DEMO_STOCKS.map((stock, index) => (
          <li key={stock.ticker} style={cssVars({ "--d": index })}>
            <button type="button" aria-pressed={stock.ticker === selected} onClick={() => setSelected(stock.ticker)}>
              <Coin ticker={stock.ticker} />
              <span className="landing-row-name">
                <strong>{stock.ticker}</strong>
                <span>{stock.name}</span>
              </span>
              <Sparkline values={sparks[index]} />
              <span className="landing-row-price">${formatPrice(stock.price)}</span>
              <span className="landing-row-chg" data-dir={stock.change >= 0 ? "up" : "down"}>
                {formatPercent(stock.change, 2)}
              </span>
              <span className="landing-row-signal" data-tone={signalTone(stock.signal)}>
                {stock.signal}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="landing-sample-note">Sample data</p>
    </div>
  );
}

/* ---------- The verdict ---------- */

/** Deterministic wobble for the sketch price line (integer hash, no trig — SSR and client agree). */
function wobble(i: number) {
  let t = Math.imul(i + 1, 0x9e3779b1) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x85ebca6b) >>> 0;
  t ^= t >>> 13;
  return (t >>> 0) / 4294967296 - 0.5;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const SKETCH_STEPS = 72;
const SKETCH_SPLIT = 34;
/** Where the price ends, as a share of the sketch height. Short SMA ends at 0.38, long at 0.66. */
const SKETCH_END: Record<DemoSignal, number> = { Hold: 0.14, Buy: 0.52, "Strong Buy": 0.86 };

function ReadingSketch({ signal, size }: { signal: DemoSignal; size: Size }) {
  const { w, h } = size;
  const right = w - 16;
  const xAt = (t: number) => t * right;
  const shortAt = (t: number) => h * (0.5 - 0.12 * t);
  const longAt = (t: number) => h * (0.74 - 0.08 * t);
  const split = SKETCH_SPLIT / SKETCH_STEPS;

  const priceAt = (i: number, end: number) => {
    const t = i / SKETCH_STEPS;
    const base = h * (0.3 - 0.06 * t);
    const turn = t <= split ? 0 : smooth((t - split) / (1 - split));
    // The wobble fades out so the line lands exactly on the dot.
    const fade = 1 - smooth(Math.max(0, (t - 0.86) / 0.14));
    return base + (h * end - base) * turn + wobble(i) * h * 0.05 * fade;
  };
  const points = (from: number, to: number, end: number) => {
    const out: string[] = [];
    for (let i = from; i <= to; i++) out.push(`${xAt(i / SKETCH_STEPS).toFixed(1)},${priceAt(i, end).toFixed(1)}`);
    return out.join(" ");
  };
  const end = SKETCH_END[signal];

  return (
    <svg className="landing-sketch" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <line className="landing-sketch-short" x1={0} y1={shortAt(0)} x2={right} y2={shortAt(1)} />
      <line className="landing-sketch-long" x1={0} y1={longAt(0)} x2={right} y2={longAt(1)} />
      <text x={0} y={h * 0.3 - 16}>Price</text>
      <text x={0} y={shortAt(0) + 18}>50-day SMA</text>
      <text x={0} y={longAt(0) + 18}>200-day SMA</text>
      <polyline className="landing-sketch-trunk" points={points(0, SKETCH_SPLIT, end)} />
      {/* Keyed by signal: the tail of the price line redraws to its new resting place. */}
      <g key={signal}>
        <polyline className="landing-draw landing-sketch-tail" points={points(SKETCH_SPLIT, SKETCH_STEPS, end)} pathLength={1} />
        <g className="landing-tip" transform={`translate(${right.toFixed(1)} ${(h * end).toFixed(1)})`}>
          <circle className="landing-tip-ring" r={5} />
          <circle className="landing-tip-dot" r={4.5} />
        </g>
      </g>
    </svg>
  );
}

function VerdictDemo() {
  const [frameRef, inView] = useInView<HTMLDivElement>(0.3);
  const [watchRef, visible] = useInView<HTMLDivElement>(0.3, false);
  const [plotRef, size] = useBoxSize<HTMLDivElement>({ w: 560, h: 190 });
  const [index, setIndex] = useState(READINGS.length - 1);
  const [auto, setAuto] = useState(true);
  const signal = READINGS[index];

  // Cycles through the three readings while on screen; any tap hands control to the visitor.
  useEffect(() => {
    if (!auto || !visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % READINGS.length), READING_MS);
    return () => window.clearInterval(timer);
  }, [auto, visible]);

  return (
    <div className={"landing-verdict landing-reveal" + (inView ? " is-inview" : "")} ref={frameRef}>
      <div className="landing-reading" ref={watchRef} data-reading={signalTone(signal)}>
        <div className="landing-sketch-box" ref={plotRef}>
          <ReadingSketch signal={signal} size={size} />
        </div>
        <p className="landing-reading-label">Signal</p>
        <p className="landing-reading-word" key={signal}>
          {signal}
        </p>
        <p className="landing-reading-why" key={signal + "-why"}>
          {SIGNAL_REASON[signal]}
        </p>
      </div>
      <div className="landing-switch landing-switch-wide" role="group" aria-label="Signal reading" style={cssVars({ "--index": index })}>
        {READINGS.map((item, i) => (
          <button
            type="button"
            key={item}
            aria-pressed={i === index}
            onClick={() => {
              setAuto(false);
              setIndex(i);
            }}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Page sections ---------- */

function SectionHead({ kicker, title, children }: { kicker: string; title: string; children: string }) {
  const [ref, inView] = useInView<HTMLElement>(0.35);
  return (
    <header className={"landing-section-head landing-reveal" + (inView ? " is-inview" : "")} ref={ref}>
      <p className="landing-kicker">{kicker}</p>
      <h2>{title}</h2>
      <p className="landing-section-copy">{children}</p>
    </header>
  );
}

/** Product demos sampled from the platform — landing-only markup, sample data. */
export function LandingDemos() {
  return (
    <div className="landing-demos">
      <section className="landing-section landing-section-graph" id="graph-analysis" aria-label="Graph Analysis">
        <SectionHead kicker="Graph Analysis" title="See the price against its own trend.">
          Closing price, the 50-day and the 200-day average on one chart. The signal reads the gap between them.
        </SectionHead>
        <GraphDemo />
      </section>

      <section className="landing-section landing-section-split" aria-label="Watchlist">
        <SectionHead kicker="Watchlist" title="Your names, one glance away.">
          Keep the stocks you follow in a dock. Each one carries its price, its day and its signal.
        </SectionHead>
        <WatchDemo />
      </section>

      <section className="landing-section landing-section-split landing-section-flip" aria-label="The verdict">
        <SectionHead kicker="The verdict" title="As easy as checking the weather.">
          Three readings, each with its reason. The further the price falls below its averages, the stronger the signal.
        </SectionHead>
        <VerdictDemo />
      </section>
    </div>
  );
}

/** Closing band: one last way into the platform, set on a planet's horizon, with the footer below it. */
export function LandingClose() {
  const [ctaRef, ctaInView] = useInView<HTMLDivElement>(0.35);
  const { user, loading } = useSessionUser();

  return (
    <div className="landing-end">
      <div className="landing-horizon" aria-hidden="true" />
      <section className="landing-cta" aria-label="Enter Intrisal">
        <div className={"landing-cta-inner landing-reveal" + (ctaInView ? " is-inview" : "")} ref={ctaRef}>
          <h2>{user ? "Back to your watchlist." : "Look up your first stock."}</h2>
          {loading ? null : user ? (
            <button
              type="button"
              className="landing-btn landing-btn-primary landing-btn-lg"
              onClick={() => void navigateWithCurtain("/home", "to-platform")}
            >
              Open platform
              <ArrowIcon />
            </button>
          ) : (
            <a href="/signup" className="landing-btn landing-btn-primary landing-btn-lg">
              Create account
              <ArrowIcon />
            </a>
          )}
        </div>
      </section>
      <footer className="landing-foot">
        <div className="landing-foot-brand">
          <span className="landing-foot-mark">Intrisal</span>
          <span>Sample data shown for illustration. Not investment advice.</span>
        </div>
        <nav className="landing-foot-legal" aria-label="Legal">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </div>
  );
}
