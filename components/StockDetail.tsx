import { useMemo, useState } from "react";
import { AnimatedPrice } from "@/components/AnimatedPrice";
import { fmt, nameOf, sample, series } from "@/lib/market";

const RANGES = { "3M": 63, "6M": 126, "1Y": 252, "All": 1260 };
type Range = keyof typeof RANGES;

function average(prices: number[], end: number, days: number) {
  return prices.slice(end - days + 1, end + 1).reduce((sum, price) => sum + price, 0) / days;
}

function PriceChart({ ticker, lines, days }: { ticker: string; lines: number[][]; days: number }) {
  const left = 66;
  const right = 704;
  const top = 14;
  const bottom = 270;
  const values = lines.flat();
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = (high - low) * 0.08 || 1;
  const max = high + padding;
  const min = Math.max(0, low - padding);
  const xAt = (progress: number) => left + progress * (right - left);
  const yAt = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);

  return (
    <svg className="stock-chart" viewBox="0 0 720 304" role="img" aria-label={ticker + " sample closing prices with 50-day and 200-day moving averages"}>
      {[0, 1, 2, 3, 4].map((tick) => {
        const value = max - (max - min) * tick / 4;
        const y = yAt(value);
        return <g key={tick}><line x1={left} x2={right} y1={y} y2={y} /><text x={left - 10} y={y} textAnchor="end" dominantBaseline="middle">${fmt(value, 0)}</text></g>;
      })}
      {lines.map((line, index) => (
        <polyline key={index} className={["stock-close", "stock-sma-short", "stock-sma-long"][index]}
          points={line.map((value, i) => `${xAt(i / (line.length - 1)).toFixed(2)},${yAt(value).toFixed(2)}`).join(" ")} />
      ))}
      {[0, 1, 2, 3, 4].map((tick) => (
        <text key={tick} x={xAt(tick / 4)} y={296} textAnchor={tick === 4 ? "end" : tick === 0 ? "start" : "middle"}>
          {tick === 4 ? "Latest" : `${Math.round((days - 1) * (1 - tick / 4))}d ago`}
        </text>
      ))}
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
  const { price } = sample(ticker);
  const short = shortSma[shortSma.length - 1];
  const long = longSma[longSma.length - 1];
  const above = price >= long;
  const signal = price < long ? "Strong Buy" : price < short ? "Buy" : "Hold";
  const signalClass = signal === "Hold" ? "stock-neutral" : "stock-positive";
  const year = closes.slice(-RANGES["1Y"]);
  const yearReturn = (price / year[0] - 1) * 100;
  const low = Math.min(...year);
  const high = Math.max(...year);
  const position = high > low ? (price - low) / (high - low) * 100 : 50;
  let cross: { name: string; daysAgo: number; up: boolean } | undefined;
  for (let i = shortSma.length - 1; i > 0; i--) {
    const up = shortSma[i] >= longSma[i];
    if (up !== (shortSma[i - 1] >= longSma[i - 1])) {
      cross = { name: up ? "Bullish Trend" : "Bearish Trend", daysAgo: shortSma.length - 1 - i, up };
      break;
    }
  }
  const days = RANGES[range];

  return (
    <section className="stock-detail" aria-label={ticker + " stock details"}>
      <article className="panel stock-chart-panel">
        <div className="stock-chart-header">
          <div>
            <h2>{ticker} <span>{nameOf(ticker)}</span></h2>
            <p className={signalClass}>{signal}</p>
          </div>
          <div className="stock-ranges" role="group" aria-label="Chart range">
            {(Object.keys(RANGES) as Range[]).map((item) => (
              <button type="button" key={item} aria-pressed={item === range} onClick={() => setRange(item)}>{item}</button>
            ))}
          </div>
        </div>
        <PriceChart ticker={ticker} days={days} lines={[closes, shortSma, longSma].map((line) => line.slice(-days))} />
        <ul className="stock-legend" aria-label="Chart legend">
          <li className="stock-close">Closing price</li>
          <li className="stock-sma-short">50-day SMA</li>
          <li className="stock-sma-long">200-day SMA</li>
        </ul>
      </article>
      <aside className="panel stock-snapshot" aria-label="Latest sample snapshot">
        <h2>Latest snapshot</h2>
        <div className="stock-snapshot-price"><AnimatedPrice price={price} /></div>
        <p className="stock-caption">Sample closing price</p>
        <dl>
          <div><dt>Signal</dt><dd className={signalClass}>{signal}</dd></div>
          <div><dt>1Y return</dt><dd className={yearReturn >= 0 ? "stock-positive" : "stock-negative"}>{yearReturn >= 0 ? "+" : ""}{fmt(yearReturn, 1)}%</dd></div>
          <div>
            <dt>52-week closing range</dt>
            <dd className="stock-range">
              <span>{fmt(position, 0)}% of range</span>
              <div className="stock-range-track" aria-hidden="true"><span style={{ left: position + "%" }} /></div>
              <div className="stock-range-labels"><span>${fmt(low, 2)}</span><span>${fmt(high, 2)}</span></div>
            </dd>
          </div>
          <div>
            <dt>Market trend</dt>
            <dd className={cross ? (cross.up ? "stock-positive" : "stock-negative") : undefined}>{cross?.name ?? "No crossover in sample"}</dd>
            {cross && <dd className="stock-caption">{cross.daysAgo ? `${cross.daysAgo} trading days ago` : "Latest close"}</dd>}
          </div>
        </dl>
      </aside>
    </section>
  );
}
