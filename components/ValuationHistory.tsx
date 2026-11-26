"use client";

import { useId, useState } from "react";
import { ChartReveal } from "@/components/ChartReveal";
import { fmt } from "@/lib/market";
import type { CompanySnapshot } from "@/lib/companyData";
import { quarterLabelFromEnd } from "@/components/Fundamentals";

function multiple(value: number) {
  return `${fmt(value, 1)}x`;
}

export function ValuationHistory({ ticker, snapshot, loading }: {
  ticker: string;
  snapshot: CompanySnapshot | null;
  loading: boolean;
}) {
  const id = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  const quarters = snapshot?.valuationPoints?.map((point) => ({
    quarter: point.quarter, value: point.ev_nopat, price: point.close, nopat: point.nopat,
  })) ?? [];
  const count = quarters.length;
  const average = snapshot?.evNopatAvg;
  const benchmarkQuarters = snapshot?.evNopatAverageQuarters;
  if (count < 2 || average == null) return <p className="panel">{loading ? "Loading valuation history…" : "Data unavailable. More reported financials and historical prices are needed to chart valuation history."}</p>;
  const active = Math.min(hovered ?? count - 1, count - 1);
  const values = quarters.map(({ value }) => value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = quarters[count - 1];
  const current = quarters[active];
  const difference = (latest.value / average - 1) * 100;
  const tickIndexes = [...new Set(Array.from({ length: 5 }, (_, i) => Math.round(i * (count - 1) / 4)))];

  const left = 46;
  const right = 784;
  const top = 24;
  const bottom = 248;
  const step = (right - left) / Math.max(1, count - 1);
  const padding = (high - low) * 0.13 || 1;
  const min = low - padding;
  const max = high + padding;
  const x = (index: number) => left + index * step;
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const baseline = y(average);
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
          {difference > 0 ? "+" : ""}
          {fmt(difference, 1)}% vs 10Y avg
        </span>
      </div>
      <p className="valuation-caption">
        Quarterly history{benchmarkQuarters != null && benchmarkQuarters < 40
          ? ` · 10Y average uses ${benchmarkQuarters} available quarters` : ""}
      </p>

      <svg
        className="valuation-plot"
        viewBox="0 0 800 278"
        role="img"
        aria-label={`${ticker} EV/NOPAT over ${count} quarters with a dashed ten-year average`}
        onPointerLeave={() => setHovered(null)}
      >
        <defs>
          <clipPath id={id + "-above"}>
            <rect x={left} y={top} width={right - left} height={Math.max(0, baseline - top)} />
          </clipPath>
          <clipPath id={id + "-below"}>
            <rect x={left} y={baseline} width={right - left} height={Math.max(0, bottom - baseline)} />
          </clipPath>
        </defs>
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = min + ((max - min) * tick) / 4;
          return (
            <g key={tick}>
              <line className="valuation-gridline" x1={left} x2={right} y1={y(value)} y2={y(value)} />
              <text x={left - 7} y={y(value)} textAnchor="end" dominantBaseline="middle">
                {fmt(value, 0)}x
              </text>
            </g>
          );
        })}
        {tickIndexes.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={272}
            textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
          >
            {quarterLabelFromEnd(quarters[index].quarter).slice(-4)}
          </text>
        ))}
        <line className="valuation-average" x1={left} x2={right} y1={baseline} y2={baseline} />
        <ChartReveal left={left} right={right} top={top} bottom={bottom}>
          <path className="valuation-area" data-side="above" d={fill} clipPath={`url(#${id}-above)`} />
          <path className="valuation-area" data-side="below" d={fill} clipPath={`url(#${id}-below)`} />
          <path className="valuation-line" d={line} />
          <line className="valuation-gridline" x1={x(active)} x2={x(active)} y1={top} y2={bottom} />
          <circle className="valuation-point" cx={x(active)} cy={y(current.value)} r={4} />
        </ChartReveal>
        {quarters.map((_, index) => (
          <rect
            key={index}
            x={x(index) - step / 2}
            y={top}
            width={step}
            height={bottom - top}
            fill="transparent"
            onPointerEnter={() => setHovered(index)}
          />
        ))}
      </svg>

      <div className="valuation-legend">
        <span>EV/NOPAT by quarter</span>
        <span>10Y average · {multiple(average)}</span>
      </div>
      <p className="valuation-quarter">
        <strong>{quarterLabelFromEnd(current.quarter)}</strong>
        <span>
          EV/NOPAT <strong>{multiple(current.value)}</strong>
        </span>
        <span>
          Price <strong>${fmt(current.price, 2)}</strong>
        </span>
        <span>
          TTM NOPAT <strong>${fmt(current.nopat, 1)}B</strong>
        </span>
      </p>

      <dl className="valuation-summary">
        <div>
          <dt>History low</dt>
          <dd>{multiple(low)}</dd>
        </div>
        <div>
          <dt>History high</dt>
          <dd>{multiple(high)}</dd>
        </div>
        <div>
          <dt>Latest quarter vs 10Y avg</dt>
          <dd>
            {multiple(latest.value)} vs {multiple(average)}
          </dd>
        </div>
        <div>
          <dt>Latest quarter</dt>
          <dd>{quarterLabelFromEnd(latest.quarter)}</dd>
        </div>
      </dl>
    </article>
  );
}
