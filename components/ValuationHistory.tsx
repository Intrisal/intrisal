"use client";

import { useEffect, useId, useState } from "react";
import { ChartReveal } from "@/components/ChartReveal";
import { fmt } from "@/lib/market";
import type { CompanySnapshot } from "@/lib/companyData";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";
import { quarterLabelFromEnd } from "@/components/Fundamentals";
import type { DailyValuation } from "@/lib/valuationReview";

const VALUATION_MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const VALUATION_CLOSE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const FAIR_VALUE_PERCENT = 5.5;
const VALUATION_STATUS = { below: "Undervalued", fair: "Fair Value", above: "Overvalued" } as const;

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
  const [dailyData, setDailyData] = useState<{ ticker: string; daily: DailyValuation[] } | null>(null);
  const loadDaily = !loading && snapshot?.ticker === ticker && snapshot.valuationReview === true &&
    snapshot.valuationAverageYears != null && snapshot.evNopatAvg != null &&
    !snapshot.valuationHidden && !snapshot.valuationHasNegativeOperatingIncome;
  useEffect(() => {
    if (!loadDaily) return;
    const controller = new AbortController();
    fetch(`/api/stock/${encodeURIComponent(ticker)}/valuation-daily`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Daily valuation unavailable");
        const { daily } = await response.json() as { daily: DailyValuation[] };
        if (!controller.signal.aborted) setDailyData({ ticker, daily });
      })
      .catch(() => {
        if (!controller.signal.aborted) setDailyData({ ticker, daily: [] });
      });
    return () => controller.abort();
  }, [loadDaily, ticker]);

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

  const quarterly = snapshot?.valuationPoints ?? [];
  const daily = loadDaily && dailyData?.ticker === ticker ? dailyData.daily : [];
  const dailyAvailable = daily.filter(({ point }) => point !== null).length >= 2;
  let segmentId = 0;
  const series = dailyAvailable ? daily.flatMap(({ date, point }, index) => {
    if (!point) { segmentId++; return []; }
    if (index > 0 && Date.parse(date) - Date.parse(daily[index - 1].date) > 7 * DAY_MS) segmentId++;
    return [{ ...point, date, segmentId }];
  }) : quarterly.map((point) => ({ ...point, date: point.quarter, segmentId: 0 }));
  const quarters = series.map((point) => ({
    quarter: point.date, financialQuarter: point.quarter, segmentId: point.segmentId,
    value: point.ev_nopat, price: point.close, nopat: point.nopat,
    sharesEstimated: point.sharesEstimated,
    earningsRelease: point.earningsRelease,
    debtEstimate: point.debtEstimate,
  }));
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
  if (count < 2 || average == null || quarterly.length === 0) return (
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
  const latestQuarter = quarterly[quarterly.length - 1];
  const current = quarters[active];
  const currentComparison = review ? snapshot?.evNopat : null;
  const dailyUsesDifferentFinancials = dailyAvailable && currentComparison != null &&
    snapshot?.valuationPriceAsOf === latest.quarter &&
    fmt(currentComparison, 1) !== fmt(latest.value, 1);
  const difference = ((currentComparison ?? latestQuarter.ev_nopat) / average - 1) * 100;
  // Keep the exact boundaries inclusive despite floating-point noise.
  const comparisonPercent = Number(difference.toFixed(10));
  const valuationSide = comparisonPercent < -FAIR_VALUE_PERCENT ? "below"
    : comparisonPercent > FAIR_VALUE_PERCENT ? "above" : "fair";
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
  const chartEnd = !dailyAvailable && review && lastUnavailable?.kind === "nonpositive-nopat"
    ? Math.max(lastDate, Date.parse(lastUnavailable.quarter)) : lastDate;
  const dateSpan = chartEnd - firstDate;
  const dateX = (date: number) => left + (right - left) * (date - firstDate) / dateSpan;
  const hoverWidth = review ? Math.min(step, (right - left) * 90 * DAY_MS / dateSpan) : step;
  const padding = (high - low) * 0.13 || 1;
  const min = low - padding;
  const max = high + padding;
  const x = (index: number) => review ? dateX(dates[index]) : left + index * step;
  const visibleGaps = dailyAvailable ? daily.flatMap(({ date, point }) =>
    point || date < quarters[0].quarter || date > latest.quarter ? [] : [{
      quarter: date, kind: "missing-data" as const, detail: "Valuation inputs were unavailable for this close.",
    }]) : review ? (snapshot?.unavailableValuationQuarters ?? []).filter(({ quarter }) => {
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
    const startsNewSegment = index > 0 && (dailyAvailable
      ? quarters[index].segmentId !== quarters[index - 1].segmentId
      : review && !isFiscalQuarterGap((dates[index] - dates[index - 1]) / DAY_MS));
    if (!segment || startsNewSegment) {
      segments.push({ start: index, end: index, path: `M ${x(index)} ${y(value)}` });
    } else if (dailyAvailable) {
      segment.path += ` L ${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
      segment.end = index;
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
      {!currentCannotCalculate && <div className="valuation-status-row" data-side={valuationSide}>
        <div className="valuation-status">
          {VALUATION_STATUS[valuationSide]}
        </div>
        <span className="valuation-badge">
          {difference > 0 ? "+" : ""}
          {fmt(difference, 1)}% vs {averageLabel}
        </span>
      </div>}
      {currentMultiple}
      <p className="valuation-caption">
        {currentComparison == null && !currentCannotCalculate ? "Badge uses latest quarter-end EV/NOPAT · " : ""}
        {dailyAvailable ? "Daily closes · Financials take effect after SEC filing" : loadDaily && dailyData?.ticker !== ticker
          ? "Loading daily valuation history…" : loadDaily ? "Daily history unavailable · Showing quarterly history" : "Quarterly history"}{benchmarkQuarters != null && benchmarkQuarters < averageYears * 4
          ? ` · ${averageYears}Y average uses ${benchmarkQuarters} available quarters` : ""}
        {quarters.some(({ debtEstimate }) => debtEstimate) && " · Includes estimated debt"}
        {dailyUsesDifferentFinancials && ` · Daily series uses filed financials through ${quarterLabelFromEnd(latest.financialQuarter)}`}
      </p>

      <svg
        className="valuation-plot"
        viewBox="0 0 800 278"
        role="img"
        aria-label={`${ticker} EV/NOPAT over ${count} ${dailyAvailable ? "trading days" : "quarters"} with a dashed ${averageYears}-year quarterly average`}
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
        {dailyAvailable ? <rect x={left} y={top} width={right - left} height={bottom - top} fill="transparent"
          onPointerMove={(event) => {
            const matrix = event.currentTarget.getScreenCTM();
            if (!matrix) return;
            const { x: pointerX } = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            const nearest = hitTargets.reduce((best, target) =>
              Math.abs(target.x - pointerX) < Math.abs(best.x - pointerX) ? target : best);
            setHovered(nearest.quarter);
          }}
        /> : hitTargets.map((target) => (
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
        <span>{dailyAvailable ? "EV/NOPAT by trading day" : "EV/NOPAT by quarter"}</span>
        <span>{averageYears}Y quarterly average · {multiple(average)}</span>
      </div>
      {activeGap ? <p className="valuation-quarter">
        <strong>{dailyAvailable ? VALUATION_CLOSE_FORMAT.format(Date.parse(activeGap.quarter)) : quarterLabelFromEnd(activeGap.quarter)}</strong>
        <span>EV/NOPAT <strong>{activeGap.kind === "nonpositive-nopat" ? "Can’t calculate" : "Data unavailable"}</strong></span>
        <span>{activeGap.detail}</span>
      </p> : <p className="valuation-quarter">
        <strong>{dailyAvailable ? VALUATION_CLOSE_FORMAT.format(Date.parse(current.quarter)) : quarterLabelFromEnd(current.quarter)}</strong>
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
        {dailyAvailable && <span>Financials through {quarterLabelFromEnd(current.financialQuarter)}</span>}
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
            {multiple(latestQuarter.ev_nopat)} vs {multiple(average)}
          </dd>
        </div>
        <div>
          <dt>Latest quarter</dt>
          <dd>{quarterLabelFromEnd(latestQuarter.quarter)}</dd>
        </div>
      </dl>
    </article>
  );
}
