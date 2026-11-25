"use client";

import { useId, useState } from "react";
import { fmt, hashStr, rng, sample, series } from "@/lib/market";

const QUARTERS = 40;
const LATEST_QUARTER = 2026 * 4 + 2;
const TICKS = [0, 8, 16, 24, 32, 39];

function quarterLabel(index: number) {
  const quarter = LATEST_QUARTER - (QUARTERS - 1 - index);
  return `Q${quarter % 4 + 1} ${Math.floor(quarter / 4)}`;
}

function multiple(value: number) {
  return `${fmt(value, 1)}x`;
}

function valuationHistory(ticker: string) {
  const stock = sample(ticker);
  const random = rng(hashStr(ticker + ":valuation"));
  const phase = random() * Math.PI * 2;
  const prices = series(ticker, "valuation-quarterly", QUARTERS);
  const deviations = prices.slice(0, -1).map((_, index) =>
    Math.sin(index * 0.22 + phase) * 0.13 +
    Math.sin(index * 0.61 + phase) * 0.05 +
    (random() - 0.5) * 0.08,
  );
  const meanDeviation = deviations.reduce((sum, value) => sum + value, 0) / deviations.length;
  const priorAverage = (stock.avg * QUARTERS - stock.evn) / (QUARTERS - 1);
  const multiples = [
    ...deviations.map((value) => priorAverage * (1 + value - meanDeviation)),
    stock.evn,
  ];

  return multiples.map((value, index) => ({
    value,
    price: prices[index],
    nopat: stock.opinc * 0.79 / (1 + stock.growth / 100) ** ((QUARTERS - 1 - index) / 4),
  }));
}

export function ValuationHistory({ ticker }: { ticker: string }) {
  const id = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? QUARTERS - 1;
  const quarters = valuationHistory(ticker);
  const values = quarters.map(({ value }) => value);
  const average = values.reduce((sum, value) => sum + value, 0) / QUARTERS;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = quarters[QUARTERS - 1];
  const current = quarters[active];
  const difference = (latest.value / average - 1) * 100;

  const left = 46;
  const right = 784;
  const top = 24;
  const bottom = 248;
  const step = (right - left) / (QUARTERS - 1);
  const padding = (high - low) * 0.13;
  const min = low - padding;
  const max = high + padding;
  const x = (index: number) => left + index * step;
  const y = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
  const baseline = y(average);
  // Horizontal tangents keep the curve within the two neighboring values.
  const line = values.reduce((path, value, index) => {
    if (index === 0) return `M ${x(0)} ${y(value)}`;
    const mid = x(index) - step / 2;
    return `${path} C ${mid} ${y(values[index - 1])}, ${mid} ${y(value)}, ${x(index)} ${y(value)}`;
  }, "");
  const fill = `${line} L ${right} ${baseline} H ${left} Z`;

  return (
    <article className="panel valuation-history" aria-labelledby={id + "-title"}>
      <h3 id={id + "-title"}>EV/NOPAT</h3>
      <div className="valuation-status-row">
        <div className="valuation-status" data-side={difference <= 0 ? "below" : "above"}>
          {difference <= 0 ? "Undervalued" : "Overvalued"}
        </div>
        <span className="valuation-badge" data-side={difference <= 0 ? "below" : "above"}>
          {difference > 0 ? "+" : ""}{fmt(difference, 1)}% vs 10Y average
        </span>
      </div>
      <p className="valuation-caption">Quarterly history</p>

      <svg className="valuation-plot" viewBox="0 0 800 278" role="img"
        aria-label={`${ticker} EV/NOPAT over 40 quarters with a dashed 10-year average`}
        onPointerLeave={() => setHovered(null)}>
        <defs>
          <clipPath id={id + "-above"}><rect x={left} y={top} width={right - left} height={baseline - top} /></clipPath>
          <clipPath id={id + "-below"}><rect x={left} y={baseline} width={right - left} height={bottom - baseline} /></clipPath>
        </defs>
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = min + (max - min) * tick / 4;
          return <g key={tick}>
            <line className="valuation-gridline" x1={left} x2={right} y1={y(value)} y2={y(value)} />
            <text x={left - 7} y={y(value)} textAnchor="end" dominantBaseline="middle">{fmt(value, 0)}x</text>
          </g>;
        })}
        {TICKS.map((index) => (
          <text key={index} x={x(index)} y={272} textAnchor={index === 0 ? "start" : index === QUARTERS - 1 ? "end" : "middle"}>
            {quarterLabel(index).slice(-4)}
          </text>
        ))}
        <path className="valuation-area" data-side="above" d={fill} clipPath={`url(#${id}-above)`} />
        <path className="valuation-area" data-side="below" d={fill} clipPath={`url(#${id}-below)`} />
        <line className="valuation-average" x1={left} x2={right} y1={baseline} y2={baseline} />
        <path className="valuation-line" d={line} />
        <line className="valuation-gridline" x1={x(active)} x2={x(active)} y1={top} y2={bottom} />
        <circle className="valuation-point" cx={x(active)} cy={y(current.value)} r={4} />
        {quarters.map((_, index) => (
          <rect key={index} x={x(index) - step / 2} y={top} width={step} height={bottom - top}
            fill="transparent" onPointerEnter={() => setHovered(index)} />
        ))}
      </svg>

      <div className="valuation-legend">
        <span>EV/NOPAT by quarter</span>
        <span>10Y average · {multiple(average)}</span>
      </div>
      <p className="valuation-quarter">
        <strong>{quarterLabel(active)}</strong>
        <span>EV/NOPAT <strong>{multiple(current.value)}</strong></span>
        <span>Price <strong>${fmt(current.price, 2)}</strong></span>
        <span>TTM NOPAT <strong>${fmt(current.nopat, 1)}B</strong></span>
      </p>

      <dl className="valuation-summary">
        <div><dt>10Y low</dt><dd>{multiple(low)}</dd></div>
        <div><dt>10Y high</dt><dd>{multiple(high)}</dd></div>
        <div><dt>Today vs 10Y average</dt><dd>{multiple(latest.value)} vs {multiple(average)}</dd></div>
        <div><dt>Latest sample quarter</dt><dd>{quarterLabel(QUARTERS - 1)}</dd></div>
      </dl>
    </article>
  );
}
