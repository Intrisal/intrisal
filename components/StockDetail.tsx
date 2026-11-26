"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { AnimatedPrice, useAnimatedNumber } from "@/components/AnimatedPrice";
import { ChartReveal } from "@/components/ChartReveal";
import { fmt } from "@/lib/market";
import type { CompanySnapshot } from "@/lib/companyData";
import { useStockHistory } from "@/lib/useMarketData";

const RANGES = { "3M": 63, "6M": 126, "1Y": 252, "5Y": 1050, "All": 1260 };
type Range = keyof typeof RANGES;
const RANGE_OPTIONS = Object.keys(RANGES) as Range[];
const CLOSE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
const CHART_MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const CHART_MONTH_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short", year: "2-digit", timeZone: "UTC",
});

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
  days,
  dates,
}: {
  ticker: string;
  lines: number[][];
  days: number;
  dates: string[];
}) {
  const left = 34;
  const right = 704;
  const top = 14;
  const bottom = 344;
  // Ignore non-positive glitch values so a bad close cannot pin the axis at $0.
  const values = lines.flat().filter((value) => Number.isFinite(value) && value > 0);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const padding = (high - low) * 0.08 || 1;
  const max = high + padding;
  const min = Math.max(0, low - padding);
  const xAt = (progress: number) => left + progress * (right - left);
  const yAt = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const tickCount = days === RANGES["3M"] ? 4 : 5;
  const dateFormat = days <= RANGES["6M"] ? CHART_MONTH_FORMAT : CHART_MONTH_YEAR_FORMAT;

  return (
    <svg
      className="stock-chart"
      viewBox="0 0 720 378"
      role="img"
      aria-label={ticker + " closing prices with 50-day and 200-day moving averages"}
    >
      {[0, 1, 2, 3, 4].map((tick) => {
        const value = max - ((max - min) * tick) / 4;
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
      <ChartReveal left={left} right={right} top={top} bottom={bottom}>
        {lines.map((line, index) => (
          <polyline
            key={index}
            className={["stock-close", "stock-sma-short", "stock-sma-long"][index]}
            points={line
              .map((value, i) => `${xAt(i / Math.max(1, line.length - 1)).toFixed(2)},${yAt(value).toFixed(2)}`)
              .join(" ")}
          />
        ))}
      </ChartReveal>
      {Array.from({ length: tickCount }, (_, tick) => {
        const progress = tick / (tickCount - 1);
        const index = Math.min(dates.length - 1, Math.round(progress * (dates.length - 1)));
        const iso = dates[index];
        return (
          <text
            key={tick}
            x={xAt(progress)}
            y={370}
            textAnchor={progress === 1 ? "end" : progress === 0 ? "start" : "middle"}
          >
            {iso ? dateFormat.format(new Date(iso + "T00:00:00Z")) : ""}
          </text>
        );
      })}
    </svg>
  );
}

export function StockDetail({ ticker, snapshot }: { ticker: string; snapshot: CompanySnapshot | null }) {
  const [range, setRange] = useState<Range>("1Y");
  const { history, loading, error } = useStockHistory(ticker);

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

  const yearSlice = Math.min(RANGES["1Y"], chart.closes.length);
  const year = chart.closes.slice(-yearSlice).filter((value) => value > 0 && Number.isFinite(value));
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

  const days = Math.min(RANGES[range], Math.max(2, chart.closes.length));
  const rangeStart = Math.max(0, chart.closes.length - days);
  const rangeCloses = chart.closes.slice(rangeStart);
  const rangeDates = chart.dates.slice(rangeStart);
  const rangeShort = chart.shortSma.slice(rangeStart);
  const rangeLong = chart.longSma.slice(rangeStart);
  const rangeReturn =
    rangeCloses.length > 1 ? (rangeCloses[rangeCloses.length - 1] / rangeCloses[0] - 1) * 100 : 0;

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
              <button type="button" key={item} aria-pressed={item === range} onClick={() => setRange(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="stock-chart-return">
            <span className="stock-chart-return-label">{range === "All" ? "All-time" : range} return</span>
            {rangeCloses.length > 1 ? <AnimatedReturn value={rangeReturn} /> : <strong>—</strong>}
          </div>
        </div>
        {loading && !history ? (
          <p className="stock-chart-status">Loading closing prices…</p>
        ) : rangeCloses.length > 1 ? (
          <PriceChart
            ticker={ticker}
            days={days}
            dates={rangeDates}
            lines={[rangeCloses, rangeShort, rangeLong]}
          />
        ) : (
          <p className="stock-chart-status">{error || "No price history available yet."}</p>
        )}
        <ul className="stock-legend" aria-label="Chart legend">
          <li className="stock-close">Closing price</li>
          <li className="stock-sma-short">50-day SMA</li>
          <li className="stock-sma-long">200-day SMA</li>
        </ul>
      </article>
      <aside className="stock-snapshot" aria-label="Latest snapshot">
        <h2>Latest snapshot</h2>
        <div className="stock-snapshot-price">
          {price === null ? "—" : <AnimatedPrice price={price} />}
        </div>
        {priceDate && <time className="stock-snapshot-date" dateTime={priceDate}>
          Close as of {CLOSE_DATE_FORMAT.format(new Date(priceDate + "T00:00:00Z"))}
        </time>}
        <dl>
          <div>
            <dt>Signal</dt>
            <dd className={signal ? signalClass : undefined}>{signal === null ? "—" : signal === "Hold" ? signal : <SnapshotGlow label={signal} />}</dd>
          </div>
          <div>
            <dt>Market trend</dt>
            <dd className={cross ? (cross.up ? "stock-positive" : "stock-negative") : undefined}>
              {cross?.up ? <SnapshotGlow label={cross.name} /> : (cross?.name ?? (chart.closes.length ? "No crossover yet" : "—"))}
            </dd>
          </div>
          <div>
            <dt>Market cap</dt>
            <dd>
              {marketCapBillions == null
                ? "—"
                : marketCapBillions >= 1000
                  ? "$" + fmt(marketCapBillions / 1000, 2) + "T"
                  : "$" + fmt(marketCapBillions, 2) + "B"}
            </dd>
          </div>
          <div>
            <dt>Dividend Yield</dt>
            <dd>{dividendYieldPercent == null ? "—" : fmt(dividendYieldPercent, 2) + "%"}</dd>
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
            </dd> : <dd>—</dd>}
          </div>
        </dl>
      </aside>
    </section>
  );
}
