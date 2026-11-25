import { useMemo, useState, type CSSProperties } from "react";
import { AnimatedPrice, useAnimatedNumber } from "@/components/AnimatedPrice";
import { fmt, sample, series } from "@/lib/market";

const RANGES = { "3M": 63, "6M": 126, "1Y": 252, "5Y": 1050, "All": 1260 };
type Range = keyof typeof RANGES;
const RANGE_OPTIONS = Object.keys(RANGES) as Range[];
const EARNINGS_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
const CHART_MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const CHART_MONTH_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short", year: "2-digit", timeZone: "UTC",
});

function chartSessionDate(sessionsAgo: number) {
  // Demo closing prices have no dates, so map sessions to the demo calendar.
  const calendarDaysAgo = Math.round(sessionsAgo * 365.25 / RANGES["1Y"]);
  return new Date(Date.UTC(2026, 10, 24 - calendarDaysAgo));
}

function average(prices: number[], end: number, days: number) {
  return prices.slice(end - days + 1, end + 1).reduce((sum, price) => sum + price, 0) / days;
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

function PriceChart({ ticker, lines, days }: { ticker: string; lines: number[][]; days: number }) {
  const left = 34;
  const right = 704;
  const top = 14;
  const bottom = 344;
  const values = lines.flat();
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = (high - low) * 0.08 || 1;
  const max = high + padding;
  const min = Math.max(0, low - padding);
  const xAt = (progress: number) => left + progress * (right - left);
  const yAt = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
  const tickCount = days === RANGES["3M"] ? 4 : 5;
  const dateFormat = days <= RANGES["6M"] ? CHART_MONTH_FORMAT : CHART_MONTH_YEAR_FORMAT;

  return (
    <svg className="stock-chart" viewBox="0 0 720 378"
      role="img" aria-label={ticker + " sample closing prices with 50-day and 200-day moving averages"}>
      {[0, 1, 2, 3, 4].map((tick) => {
        const value = max - (max - min) * tick / 4;
        const y = yAt(value);
        return <g key={tick}><line x1={left} x2={right} y1={y} y2={y} /><text x={left - 8} y={y} textAnchor="end" dominantBaseline="middle">${fmt(value, 0)}</text></g>;
      })}
      {lines.map((line, index) => (
        <polyline key={index} className={["stock-close", "stock-sma-short", "stock-sma-long"][index]}
          points={line.map((value, i) => `${xAt(i / (line.length - 1)).toFixed(2)},${yAt(value).toFixed(2)}`).join(" ")} />
      ))}
      {Array.from({ length: tickCount }, (_, tick) => {
        const progress = tick / (tickCount - 1);
        const sessionsAgo = Math.round((days - 1) * (1 - progress));
        return (
          <text key={tick} x={xAt(progress)} y={370} textAnchor={progress === 1 ? "end" : progress === 0 ? "start" : "middle"}>
            {dateFormat.format(chartSessionDate(sessionsAgo))}
          </text>
        );
      })}
    </svg>
  );
}

export function StockDetail({ ticker }: { ticker: string }) {
  const [range, setRange] = useState<Range>("1Y");
  const { closes, shortSma, longSma } = useMemo(() => {
    const history = series(ticker, "stock-detail", RANGES.All + 199);
    const closes = history.slice(199);
    return {
      closes,
      shortSma: closes.map((_, index) => average(history, index + 199, 50)),
      longSma: closes.map((_, index) => average(history, index + 199, 200)),
    };
  }, [ticker]);
  const { price, marketCapBillions, nextEarningsDate, dividendYieldPercent } = sample(ticker);
  const short = shortSma[shortSma.length - 1];
  const long = longSma[longSma.length - 1];
  const signal = price < long ? "Strong Buy" : price < short ? "Buy" : "Hold";
  const signalClass = signal === "Hold" ? "stock-neutral" : "stock-positive";
  const year = closes.slice(-RANGES["1Y"]);
  const low = Math.min(...year);
  const high = Math.max(...year);
  const position = high > low ? (price - low) / (high - low) * 100 : 50;
  let cross: { name: string; up: boolean } | undefined;
  for (let i = shortSma.length - 1; i > 0; i--) {
    const up = shortSma[i] >= longSma[i];
    if (up !== (shortSma[i - 1] >= longSma[i - 1])) {
      cross = { name: up ? "Bullish Trend" : "Bearish Trend", up };
      break;
    }
  }
  const days = RANGES[range];
  const rangeReturn = (closes[closes.length - 1] / closes[closes.length - days] - 1) * 100;

  return (
    <section className="panel stock-detail" aria-label={ticker + " stock details"}>
      <article className="stock-chart-panel">
        <div className="stock-chart-header">
          <div className="stock-ranges" role="group" aria-label="Chart range"
            style={{ "--range-index": RANGE_OPTIONS.indexOf(range) } as CSSProperties}>
            {RANGE_OPTIONS.map((item) => (
              <button type="button" key={item} aria-pressed={item === range} onClick={() => setRange(item)}>{item}</button>
            ))}
          </div>
          <div className="stock-chart-return">
            <span className="stock-chart-return-label">{range === "All" ? "All-time" : range} return</span>
            <AnimatedReturn value={rangeReturn} />
          </div>
        </div>
        <PriceChart ticker={ticker} days={days} lines={[closes, shortSma, longSma].map((line) => line.slice(-days))} />
        <ul className="stock-legend" aria-label="Chart legend">
          <li className="stock-close">Closing price</li>
          <li className="stock-sma-short">50-day SMA</li>
          <li className="stock-sma-long">200-day SMA</li>
        </ul>
      </article>
      <aside className="stock-snapshot" aria-label="Latest sample snapshot">
        <h2>Latest snapshot</h2>
        <div className="stock-snapshot-price"><AnimatedPrice price={price} /></div>
        <dl>
          <div>
            <dt>Signal</dt>
            <dd className={signalClass}>{signal === "Hold" ? signal : <SnapshotGlow label={signal} />}</dd>
          </div>
          <div>
            <dt>Market trend</dt>
            <dd className={cross ? (cross.up ? "stock-positive" : "stock-negative") : undefined}>
              {cross?.up ? <SnapshotGlow label={cross.name} /> : cross?.name ?? "No crossover in sample"}
            </dd>
          </div>
          <div>
            <dt>Next earnings</dt>
            <dd>
              {nextEarningsDate ? (
                <time dateTime={nextEarningsDate}>{EARNINGS_DATE_FORMAT.format(new Date(nextEarningsDate))}</time>
              ) : "N/A"}
            </dd>
          </div>
          <div>
            <dt>Market cap</dt>
            <dd>
              {marketCapBillions === null ? "N/A" :
                marketCapBillions >= 1000 ? "$" + fmt(marketCapBillions / 1000, 2) + "T" :
                  "$" + fmt(marketCapBillions, 2) + "B"}
            </dd>
          </div>
          <div>
            <dt>Dividend Yield</dt>
            <dd>{fmt(dividendYieldPercent, 2)}%</dd>
          </div>
          <div>
            <dt>52-Week Range</dt>
            <dd className="stock-range">
              <div className="stock-range-track" aria-hidden="true"><span style={{ left: position + "%" }} /></div>
              <div className="stock-range-labels"><span>${fmt(low, 2)}</span><span>${fmt(high, 2)}</span></div>
            </dd>
          </div>
        </dl>
      </aside>
    </section>
  );
}
