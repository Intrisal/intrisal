"use client";

import { useId, useState } from "react";
import { ChartReveal } from "@/components/ChartReveal";
import { fmt } from "@/lib/market";
import type { CompanySnapshot } from "@/lib/companyData";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";
import { quarterLabelFromEnd } from "@/components/Fundamentals";

const VALUATION_MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const VALUATION_CLOSE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function multiple(value: number) {
  return `${fmt(value, 1)}x`;
}

export function ValuationHistory({ ticker, snapshot, loading }: {
  ticker: string;
  snapshot: CompanySnapshot | null;
  loading: boolean;
}) {
  const id = useId();
  const [hovered, setHovered] = useState<string | null>(null);

  if (!loading && snapshot?.valuationHasNegativeOperatingIncome) {
    return (
      <article className="panel valuation-history" aria-labelledby={id + "-title"}>
        <h3 id={id + "-title"}>EV/NOPAT</h3>
        <p className="valuation-caption" role="status">
          Can’t calculate data for this stock because trailing 12-month operating income was negative.
        </p>
      </article>
    );
  }

  if (!loading && snapshot?.valuationHidden) {
    return <article className="panel valuation-history" aria-labelledby={id + "-title"} />;
  }

  const quarters = snapshot?.valuationPoints?.map((point) => ({
    quarter: point.quarter, value: point.ev_nopat, price: point.close, nopat: point.nopat,
    sharesEstimated: point.sharesEstimated,
    earningsRelease: point.earningsRelease,
    debtEstimate: point.debtEstimate,
  })) ?? [];
  const count = quarters.length;
  const average = snapshot?.evNopatAvg;
  const averageYears = snapshot?.valuationAverageYears ?? 10;
  const averageLabel = `${averageYears}Y avg`;
  const benchmarkQuarters = snapshot?.evNopatAverageQuarters;
  const review = snapshot?.valuationReview === true;
  const currentUnavailable = snapshot?.currentValuationUnavailable;
  const currentCannotCalculate = currentUnavailable?.kind === "nonpositive-nopat";
  const currentMultiple = !loading && snapshot && (review || snapshot.evNopat == null) && (
    <p className="valuation-caption">
      Current EV/NOPAT{" "}
      <strong>{snapshot.evNopat == null
        ? currentCannotCalculate ? "Can’t calculate" : "Data unavailable"
        : multiple(snapshot.evNopat)}</strong>
      {currentUnavailable && ` · ${currentUnavailable.detail}`}
      {snapshot.valuationPriceAsOf && <>
        {" · Close as of "}
        <time dateTime={snapshot.valuationPriceAsOf}>
          {VALUATION_CLOSE_FORMAT.format(new Date(snapshot.valuationPriceAsOf + "T00:00:00Z"))}
        </time>
      </>}
      {snapshot.valuationEarningsRelease && " · Earnings release · Estimated shares"}
      {snapshot.valuationDebtEstimate && " · Estimated debt"}
    </p>
  );
  if (count < 2 || average == null) return (
    <article className="panel valuation-history" aria-labelledby={id + "-title"}>
      {loading ? <p>Loading valuation history…</p> : null}
    </article>
  );
  const selectedIndex = quarters.findIndex(({ quarter }) => quarter === hovered);
  const active = selectedIndex < 0 ? count - 1 : selectedIndex;
  const values = quarters.map(({ value }) => value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const latest = quarters[count - 1];
  const current = quarters[active];
  const currentComparison = review ? snapshot?.evNopat : null;
  const difference = ((currentComparison ?? latest.value) / average - 1) * 100;
  const tickIndexes = [...new Set(Array.from({ length: 5 }, (_, i) => Math.round(i * (count - 1) / 4)))];

  const left = 46;
  const right = 784;
  const top = 24;
  const bottom = 248;
  const step = (right - left) / Math.max(1, count - 1);
  const dates = quarters.map(({ quarter }) => Date.parse(quarter));
  const firstDate = dates[0];
  const lastDate = dates[count - 1];
  const lastUnavailable = snapshot?.unavailableValuationQuarters?.at(-1);
  const chartEnd = review && lastUnavailable?.kind === "nonpositive-nopat"
    ? Math.max(lastDate, Date.parse(lastUnavailable.quarter)) : lastDate;
  const dateSpan = chartEnd - firstDate;
  const dateX = (date: number) => left + (right - left) * (date - firstDate) / dateSpan;
  const hoverWidth = review ? Math.min(step, (right - left) * 90 * DAY_MS / dateSpan) : step;
  const padding = (high - low) * 0.13 || 1;
  const min = low - padding;
  const max = high + padding;
  const x = (index: number) => review ? dateX(dates[index]) : left + index * step;
  const visibleGaps = review ? (snapshot?.unavailableValuationQuarters ?? []).filter(({ quarter }) => {
    const date = Date.parse(quarter);
    return date >= firstDate && date <= chartEnd;
  }) : [];
  const activeGap = visibleGaps.find(({ quarter }) => quarter === hovered);
  const activeX = activeGap ? dateX(Date.parse(activeGap.quarter)) : x(active);
  const hitTargets = [
    ...quarters.map(({ quarter }, index) => ({ quarter, x: x(index), gap: false })),
    ...visibleGaps.map(({ quarter }) => ({ quarter, x: dateX(Date.parse(quarter)), gap: true })),
  ].sort((a, b) => a.x - b.x);
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const baseline = y(average);
  const segments: { start: number; end: number; path: string }[] = [];
  for (const [index, value] of values.entries()) {
    const segment = segments.at(-1);
    if (!segment || (review && !isFiscalQuarterGap((dates[index] - dates[index - 1]) / DAY_MS))) {
      segments.push({ start: index, end: index, path: `M ${x(index)} ${y(value)}` });
    } else {
      const mid = (x(index - 1) + x(index)) / 2;
      segment.path += ` C ${mid} ${y(values[index - 1])}, ${mid} ${y(value)}, ${x(index)} ${y(value)}`;
      segment.end = index;
    }
  }
  const line = segments.map(({ path }) => path).join(" ");
  const fill = segments.map(({ start, end, path }) => `${path} L ${x(end)} ${baseline} H ${x(start)} Z`).join(" ");

  return (
    <article className="panel valuation-history" aria-labelledby={id + "-title"}>
      <h3 id={id + "-title"}>EV/NOPAT</h3>
      {!currentCannotCalculate && <div className="valuation-status-row">
        <div className="valuation-status" data-side={difference <= 0 ? "below" : "above"}>
          {difference <= 0 ? "Undervalued" : "Overvalued"}
        </div>
        <span className="valuation-badge" data-side={difference <= 0 ? "below" : "above"}>
          {difference > 0 ? "+" : ""}
          {fmt(difference, 1)}% vs {averageLabel}
        </span>
      </div>}
      {currentMultiple}
      <p className="valuation-caption">
        {currentComparison == null && !currentCannotCalculate ? "Badge uses latest quarter-end EV/NOPAT · " : ""}
        Quarterly history{benchmarkQuarters != null && benchmarkQuarters < averageYears * 4
          ? ` · ${averageYears}Y average uses ${benchmarkQuarters} available quarters` : ""}
        {quarters.some(({ debtEstimate }) => debtEstimate) && " · Includes estimated debt"}
      </p>

      <svg
        className="valuation-plot"
        viewBox="0 0 800 278"
        role="img"
        aria-label={`${ticker} EV/NOPAT over ${count} quarters with a dashed ${averageYears}-year average`}
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
        {review ? tickIndexes.map((_, index) => {
          const progress = index / (tickIndexes.length - 1);
          const date = new Date(firstDate + dateSpan * progress);
          return <text key={index} x={dateX(date.getTime())} y={272} textAnchor={progress === 0 ? "start" : progress === 1 ? "end" : "middle"}>
            {dateSpan >= 4 * 365 * DAY_MS ? date.getUTCFullYear() : VALUATION_MONTH_FORMAT.format(date)}
          </text>;
        }) : tickIndexes.map((index) => (
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
          {segments.filter(({ start, end }) => start === end).map(({ start }) => (
            <circle key={start} className="valuation-point" cx={x(start)} cy={y(values[start])} r={2.5} />
          ))}
          <line className="valuation-gridline" x1={activeX} x2={activeX} y1={top} y2={bottom} />
          {!activeGap && <circle className="valuation-point" cx={activeX} cy={y(current.value)} r={4} />}
        </ChartReveal>
        {hitTargets.map((target) => (
          <rect
            key={target.quarter}
            x={target.x - hoverWidth / 2}
            y={top}
            width={hoverWidth}
            height={bottom - top}
            fill="transparent"
            data-valuation-quarter={target.quarter}
            tabIndex={target.gap ? 0 : undefined}
            aria-label={target.gap ? `${quarterLabelFromEnd(target.quarter)} EV/NOPAT unavailable` : undefined}
            onPointerEnter={() => setHovered(target.quarter)}
            onPointerLeave={review ? () => setHovered(null) : undefined}
            onFocus={() => setHovered(target.quarter)}
            onBlur={() => setHovered(null)}
            onClick={() => setHovered(target.quarter)}
          />
        ))}
      </svg>

      <div className="valuation-legend">
        <span>EV/NOPAT by quarter</span>
        <span>{averageYears}Y average · {multiple(average)}</span>
      </div>
      {activeGap ? <p className="valuation-quarter">
        <strong>{quarterLabelFromEnd(activeGap.quarter)}</strong>
        <span>EV/NOPAT <strong>{activeGap.kind === "nonpositive-nopat" ? "Can’t calculate" : "Data unavailable"}</strong></span>
        <span>{activeGap.detail}</span>
      </p> : <p className="valuation-quarter">
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
        {current.earningsRelease && <span>Earnings release</span>}
        {current.sharesEstimated && <span>Estimated shares</span>}
        {current.debtEstimate && <span>{current.debtEstimate.method === "assumed-zero"
          ? "Debt assumed $0" : "Debt carried forward"}</span>}
      </p>}

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
          <dt>Latest quarter vs {averageLabel}</dt>
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
