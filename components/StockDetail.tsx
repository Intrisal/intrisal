"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatedPrice, useAnimatedNumber } from "@/components/AnimatedPrice";
import { ChartReveal } from "@/components/ChartReveal";
import { fmt } from "@/lib/market";
import type { CompanySnapshot } from "@/lib/companyData";
import { useStockHistory } from "@/lib/useMarketData";

const RANGE_MONTHS = { "3M": 3, "6M": 6, "1Y": 12, "5Y": 60, "10Y": 120 };
type Range = keyof typeof RANGE_MONTHS;
const RANGE_OPTIONS = Object.keys(RANGE_MONTHS) as Range[];
const TICK_MONTHS = { "6M": 1, "1Y": 2, "5Y": 12, "10Y": 24 };
const PRICE_STEPS = [10, 20, 50, 100, 150, 200];
const CLOSE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
const CHART_MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const CHART_DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", timeZone: "UTC",
});

/** e.g. Nov '26 — apostrophe marks the abbreviated year. */
function formatChartMonthYear(date: Date) {
  return `${CHART_MONTH_FORMAT.format(date)} '${String(date.getUTCFullYear()).slice(-2)}`;
}

function monthsBefore(date: Date, months: number) {
  const target = new Date(date);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - months);
  const end = new Date(target);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  target.setUTCDate(Math.min(date.getUTCDate(), end.getUTCDate()));
  return target;
}

function chartDateTicks(range: Range, first: Date, last: Date) {
  const ticks: Date[] = [];
  if (range === "3M") {
    const tick = new Date(last);
    tick.setUTCDate(last.getUTCDate() >= 16 ? 16 : 1);
    while (tick >= first) {
      ticks.push(new Date(tick));
      if (tick.getUTCDate() === 16) tick.setUTCDate(1);
      else tick.setUTCMonth(tick.getUTCMonth() - 1, 16);
    }
    return ticks.reverse();
  }

  for (let offset = 0; offset <= RANGE_MONTHS[range]; offset += TICK_MONTHS[range]) {
    const tick = monthsBefore(last, offset);
    if (tick < first) break;
    ticks.push(tick);
  }
  return ticks.reverse();
}

function average(prices: number[], end: number, days: number) {
  const start = Math.max(0, end - days + 1);
  const slice = prices.slice(start, end + 1);
  return slice.reduce((sum, price) => sum + price, 0) / slice.length;
}

function formatReturn(value: number) {
  if (Math.abs(value) < 0.05) return "0.0%";
  return (value > 0 ? "+" : "") + fmt(value, 1) + "%";
}

function SnapshotGlow({ label }: { label: string }) {
  return (
    <span className="stock-status-glow">
      {label}
      <span className="stock-status-shimmer" aria-hidden="true">{label}</span>
    </span>
  );
}

function AnimatedReturn({ value }: { value: number }) {
  const shown = useAnimatedNumber(value);
  return (
    <strong className={shown >= 0 ? "stock-positive" : "stock-negative"}>
      <span className="animated-number">
        <span className="settled-number">{formatReturn(value)}</span>
        <span aria-hidden="true">{formatReturn(shown)}</span>
      </span>
    </strong>
  );
}

function PriceChart({
  ticker,
  lines,
  range,
  quickReveal,
  dates,
  onScrub,
}: {
  ticker: string;
  lines: number[][];
  range: Range;
  quickReveal: boolean;
  dates: string[];
  onScrub?: (index: number | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const right = 704;
  const top = 14;
  const bottom = 344;
  // Ignore non-positive glitch values so a bad close cannot pin the axis at $0.
  const closes = lines[0] ?? [];
  const values = lines.flat().filter((value) => Number.isFinite(value) && value > 0);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const targetStep = (high - low) / 5;
  const step = PRICE_STEPS.find((increment) => increment >= targetStep)
    ?? Math.ceil(targetStep / 200) * 200;
  const min = Math.floor(low / step) * step;
  const max = Math.max(min + step, Math.ceil(high / step) * step);
  const left = Math.max(34, fmt(max, 0).length * 11 + 19);
  const timestamps = dates.map((date) => Date.parse(date + "T00:00:00Z"));
  const last = timestamps[timestamps.length - 1];
  // Keep the full 10Y axis when the stored price series starts later.
  const first = range === "10Y"
    ? monthsBefore(new Date(last), RANGE_MONTHS[range]).getTime()
    : timestamps[0];
  const span = Math.max(1, last - first);
  const xAt = (time: number) => left + ((time - first) / span) * (right - left);
  const yAt = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const dateTicks = chartDateTicks(range, new Date(first), new Date(last));
  const formatTick = (date: Date) => {
    if (range === "3M") return CHART_DAY_FORMAT.format(date);
    if (range === "6M") return CHART_MONTH_FORMAT.format(date);
    return formatChartMonthYear(date);
  };

  const setScrub = useCallback((index: number | null) => {
    setHoverIndex(index);
    onScrub?.(index);
  }, [onScrub]);

  const indexFromClientX = useCallback((clientX: number) => {
    const svg = svgRef.current;
    if (!svg || timestamps.length < 2) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = 0;
    const localX = point.matrixTransform(ctm.inverse()).x;
    const clamped = Math.min(right, Math.max(left, localX));
    const time = first + ((clamped - left) / (right - left)) * span;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < timestamps.length; i++) {
      const dist = Math.abs(timestamps[i]! - time);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }, [first, left, right, span, timestamps]);

  function onPointerMove(ev: ReactPointerEvent<SVGSVGElement>) {
    const index = indexFromClientX(ev.clientX);
    if (index !== null) setScrub(index);
  }

  function onPointerLeave() {
    setScrub(null);
  }

  const scrub = hoverIndex !== null && closes[hoverIndex] != null ? {
    index: hoverIndex,
    x: xAt(timestamps[hoverIndex]!),
    y: yAt(closes[hoverIndex]!),
    price: closes[hoverIndex]!,
    date: dates[hoverIndex]!,
  } : null;
  const tipLeft = scrub ? `${(scrub.x / 720) * 100}%` : "0%";

  return (
    <div className={"stock-chart-wrap" + (scrub ? " is-scrubbing" : "")}>
      <svg
        ref={svgRef}
        className="stock-chart"
        viewBox="0 0 720 378"
        role="img"
        aria-label={ticker + " closing prices with 50-day and 200-day moving averages. Hover or drag to read a price."}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerMove}
      >
        {Array.from({ length: (max - min) / step + 1 }, (_, tick) => {
          const value = max - step * tick;
          const y = yAt(value);
          return (
            <g key={tick}>
              <line x1={left} x2={right} y1={y} y2={y} />
              <text x={left - 8} y={y} textAnchor="end" dominantBaseline="middle">
                ${fmt(value, 0)}
              </text>
            </g>
          );
        })}
        <ChartReveal key={range} left={left} right={right} top={top} bottom={bottom} quick={quickReveal}>
          {lines.map((line, index) => (
            <polyline
              key={index}
              className={["stock-close", "stock-sma-short", "stock-sma-long"][index]}
              points={line
                .map((value, i) => `${xAt(timestamps[i]!).toFixed(2)},${yAt(value).toFixed(2)}`)
                .join(" ")}
            />
          ))}
        </ChartReveal>
        {dateTicks.map((date) => {
          const x = xAt(date.getTime());
          return (
            <text
              key={date.getTime()}
              x={x}
              y={370}
              textAnchor={x > right - 34 ? "end" : x < left + 34 ? "start" : "middle"}
            >
              {formatTick(date)}
            </text>
          );
        })}
        {/* Invisible hit target over the plot so scrubbing works over empty space too. */}
        <rect
          className="stock-chart-hit"
          x={left}
          y={top}
          width={right - left}
          height={bottom - top}
          fill="transparent"
        />
        {scrub ? (
          <g className="stock-chart-scrub" aria-hidden="true">
            <line className="stock-chart-crosshair" x1={scrub.x} x2={scrub.x} y1={top} y2={bottom} />
            <circle className="stock-chart-dot" cx={scrub.x} cy={scrub.y} r="5.5" />
          </g>
        ) : null}
      </svg>
      {scrub ? (
        <div
          className={"stock-chart-tip" + (scrub.x > (left + right) / 2 ? " is-left" : "")}
          style={{ left: tipLeft }}
        >
          <strong>${fmt(scrub.price, 2)}</strong>
          <span>{CLOSE_DATE_FORMAT.format(new Date(scrub.date + "T00:00:00Z"))}</span>
        </div>
      ) : null}
    </div>
  );
}

export function StockDetail({ ticker, snapshot }: { ticker: string; snapshot: CompanySnapshot | null }) {
  const [selection, setSelection] = useState<{ range: Range; ticker: string } | null>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const range = selection?.range ?? "1Y";
  const { history, loading, error } = useStockHistory(ticker);

  useEffect(() => {
    setScrubIndex(null);
  }, [ticker, range]);

  const chart = useMemo(() => {
    const closes = history?.closes ?? [];
    const dates = history?.dates ?? [];
    if (closes.length < 2) {
      return { closes: [] as number[], shortSma: [] as number[], longSma: [] as number[], dates: [] as string[] };
    }

    // Warm-up window for SMAs when history is short (free plans ≈ 1y).
    const shortSma = closes.map((_, index) => average(closes, index, Math.min(50, index + 1)));
    const longSma = closes.map((_, index) => average(closes, index, Math.min(200, index + 1)));
    return { closes, shortSma, longSma, dates };
  }, [history]);

  const price = history?.price ?? (snapshot?.sources.prices === "marketstack" ? snapshot.price : null);
  const priceDate = history?.asOf ?? snapshot?.priceAsOf;
  const hasFilings = snapshot?.sources.fundamentals === "edgar";
  // Never substitute sample placeholders for filing-backed fields — show N/A instead of a fake number.
  const marketCapBillions = hasFilings ? snapshot.marketCapBillions : null;
  const dividendYieldPercent = hasFilings ? snapshot.dividendYieldPercent : null;
  const short = chart.shortSma[chart.shortSma.length - 1] ?? price;
  const long = chart.longSma[chart.longSma.length - 1] ?? price;
  const signal = price === null || short === null || long === null || chart.closes.length < 2
    ? null : price < long ? "Strong Buy" : price < short ? "Buy" : "Hold";
  const signalClass = signal === "Hold" ? "stock-neutral" : "stock-positive";

  const year = chart.closes.slice(-252).filter((value) => value > 0 && Number.isFinite(value));
  const lowCandidate = history?.low52 && history.low52 > 0 ? history.low52 : null;
  const highCandidate = history?.high52 && history.high52 > 0 ? history.high52 : null;
  const low = lowCandidate ?? (year.length ? Math.min(...year) : null);
  const high = highCandidate ?? (year.length ? Math.max(...year) : null);
  const position = price !== null && low !== null && high !== null && high > low
    ? Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100)) : 50;

  let cross: { name: string; up: boolean } | undefined;
  for (let i = chart.shortSma.length - 1; i > 0; i--) {
    const up = chart.shortSma[i] >= chart.longSma[i];
    if (up !== chart.shortSma[i - 1] >= chart.longSma[i - 1]) {
      cross = { name: up ? "Bullish Trend" : "Bearish Trend", up };
      break;
    }
  }

  const latestDate = chart.dates.at(-1);
  const startDate = latestDate
    ? monthsBefore(new Date(latestDate + "T00:00:00Z"), RANGE_MONTHS[range]).toISOString().slice(0, 10)
    : "";
  const rangeStart = Math.max(0, chart.dates.findIndex((date) => date >= startDate));
  const rangeCloses = chart.closes.slice(rangeStart);
  const rangeDates = chart.dates.slice(rangeStart);
  const rangeShort = chart.shortSma.slice(rangeStart);
  const rangeLong = chart.longSma.slice(rangeStart);
  const rangeReturn =
    rangeCloses.length > 1 ? (rangeCloses[rangeCloses.length - 1]! / rangeCloses[0]! - 1) * 100 : 0;
  const scrubActive = scrubIndex !== null && scrubIndex >= 0 && scrubIndex < rangeCloses.length;
  const scrubReturn = scrubActive
    ? (rangeCloses[scrubIndex]! / rangeCloses[0]! - 1) * 100
    : rangeReturn;
  const scrubPrice = scrubActive ? rangeCloses[scrubIndex]! : null;
  const scrubDate = scrubActive ? rangeDates[scrubIndex]! : null;

  return (
    <section className="panel stock-detail" aria-label={ticker + " stock details"}>
      <article className="stock-chart-panel">
        <div className="stock-chart-header">
          <div
            className="stock-ranges"
            role="group"
            aria-label="Chart range"
            style={{ "--range-index": RANGE_OPTIONS.indexOf(range) } as CSSProperties}
          >
            {RANGE_OPTIONS.map((item) => (
              <button type="button" key={item} aria-pressed={item === range} onClick={() => {
                if (item !== range) {
                  setScrubIndex(null);
                  setSelection({ range: item, ticker });
                }
              }}>
                {item}
              </button>
            ))}
          </div>
          <div className={"stock-chart-return" + (scrubActive ? " is-scrubbing" : "")}>
            {scrubActive && scrubPrice !== null && scrubDate ? (
              <>
                <span className="stock-chart-return-label">
                  {CLOSE_DATE_FORMAT.format(new Date(scrubDate + "T00:00:00Z"))}
                  <span className={"stock-chart-scrub-return " + (scrubReturn >= 0 ? "stock-positive" : "stock-negative")}>
                    {" · "}{formatReturn(scrubReturn)}
                  </span>
                </span>
                <strong className="stock-chart-scrub-price">${fmt(scrubPrice, 2)}</strong>
              </>
            ) : (
              <>
                <span className="stock-chart-return-label">{range} return</span>
                {rangeCloses.length > 1 ? <AnimatedReturn value={rangeReturn} /> : <span className="stock-chart-return-label">Data unavailable</span>}
              </>
            )}
          </div>
        </div>
        {loading && !history ? (
          <p className="stock-chart-status">Loading closing prices…</p>
        ) : rangeCloses.length > 1 ? (
          <PriceChart
            ticker={ticker}
            range={range}
            quickReveal={selection?.ticker === ticker}
            dates={rangeDates}
            lines={[rangeCloses, rangeShort, rangeLong]}
            onScrub={setScrubIndex}
          />
        ) : (
          <p className="stock-chart-status">Data unavailable. {error || "No price history available yet."}</p>
        )}
        <ul className="stock-legend" aria-label="Chart legend">
          <li className="stock-close">Closing price</li>
          <li className="stock-sma-short">50-day SMA</li>
          <li className="stock-sma-long">200-day SMA</li>
        </ul>
      </article>
      <aside className="stock-snapshot" aria-label="Stock Price">
        <h2>Stock Price</h2>
        <div className={price === null ? "stock-snapshot-unavailable" : "stock-snapshot-price"}>
          {price === null ? "Data unavailable" : <AnimatedPrice price={price} />}
        </div>
        {priceDate && <time className="stock-snapshot-date" dateTime={priceDate}>
          Close as of {CLOSE_DATE_FORMAT.format(new Date(priceDate + "T00:00:00Z"))}
        </time>}
        <dl>
          <div>
            <dt>Signal</dt>
            <dd className={signal ? signalClass : undefined}>{signal === null ? "Data unavailable" : signal === "Hold" ? signal : <SnapshotGlow label={signal} />}</dd>
          </div>
          <div>
            <dt>Market trend</dt>
            <dd className={cross ? (cross.up ? "stock-positive" : "stock-negative") : undefined}>
              {cross?.up ? <SnapshotGlow label={cross.name} /> : (cross?.name ?? (chart.closes.length ? "No crossover yet" : "Data unavailable"))}
            </dd>
          </div>
          <div>
            <dt>Market cap</dt>
            <dd>
              {marketCapBillions == null
                ? "Data unavailable"
                : marketCapBillions >= 1000
                  ? "$" + fmt(marketCapBillions / 1000, 2) + "T"
                  : "$" + fmt(marketCapBillions, 2) + "B"}
            </dd>
          </div>
          <div>
            <dt>Dividend Yield</dt>
            <dd>{dividendYieldPercent == null ? "Data unavailable" : fmt(dividendYieldPercent, 2) + "%"}</dd>
          </div>
          <div>
            <dt>52-Week Range</dt>
            {low !== null && high !== null ? <dd className="stock-range">
              <div className="stock-range-track" aria-hidden="true">
                <span style={{ left: position + "%" }} />
              </div>
              <div className="stock-range-labels">
                <span>${fmt(low, 2)}</span>
                <span>${fmt(high, 2)}</span>
              </div>
            </dd> : <dd>Data unavailable</dd>}
          </div>
        </dl>
      </aside>
    </section>
  );
}
