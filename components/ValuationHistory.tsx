"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChartReveal } from "@/components/ChartReveal";
import { availableChartRanges, ChartRangeControl, monthsBefore, RANGE_MONTHS, RANGE_OPTIONS, type ChartRange } from "@/components/ChartRangeControl";
import { fittedChartAxis } from "@/lib/chartAxis";
import { fmt } from "@/lib/market";
import type { CompanySnapshot } from "@/lib/companyData";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";
import { quarterLabelFromEnd } from "@/components/Fundamentals";
import type { DailyValuation } from "@/lib/valuationReview";
import type { AdjustedPeDay } from "@/lib/adjustedPe";

const VALUATION_MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const VALUATION_DAY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const VALUATION_CLOSE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const FAIR_VALUE_PERCENT = 10;
const VALUATION_STATUS = { below: "Undervalued", fair: "Fair Value", above: "Overvalued" } as const;
const MEDIAN_WINDOWS = [5, 10] as const;
type MedianYears = typeof MEDIAN_WINDOWS[number];
const DEFAULT_CHART_RANGE: ChartRange = "5Y";

function multiple(value: number) {
  return `${fmt(value, 1)}x`;
}

/** Keeps the overall signal in sync with the badge gap this chart is currently showing. */
function GapReporter({ gap, onGapChange }: { gap: number | null; onGapChange?: (gap: number | null) => void }) {
  useEffect(() => {
    onGapChange?.(gap);
    return () => onGapChange?.(null);
  }, [gap, onGapChange]);
  return null;
}

const PLOT_WIDTH = 800;
const DEFAULT_PLOT_HEIGHT = 278;

export function ValuationHistory({ ticker, snapshot, loading, adjustedPe = false, paired = false, loadAdjustedHistory = true, onGapChange }: {
  ticker: string;
  snapshot: CompanySnapshot | null;
  loading: boolean;
  adjustedPe?: boolean;
  paired?: boolean;
  loadAdjustedHistory?: boolean;
  onGapChange?: (gap: number | null) => void;
}) {
  const id = useId();
  const panelClass = paired ? "valuation-history" : "panel valuation-history";
  const [plotHeight, setPlotHeight] = useState(DEFAULT_PLOT_HEIGHT);
  const plotObserver = useRef<ResizeObserver | null>(null);
  const plotRef = useCallback((plot: SVGSVGElement | null) => {
    plotObserver.current?.disconnect();
    if (!paired || !plot) return;
    // Measure the CSS-sized plot so the axes and hover coordinates share an undistorted viewBox.
    plotObserver.current = new ResizeObserver(([{ contentRect: { width, height } }]) => {
      if (width > 0 && height > 0) setPlotHeight(Math.round(height * PLOT_WIDTH / width));
    });
    plotObserver.current.observe(plot);
  }, [paired]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [rangeSelection, setRangeSelection] = useState<{ ticker: string; range: ChartRange }>({ ticker, range: DEFAULT_CHART_RANGE });
  const [medianSelection, setMedianSelection] = useState<{ ticker: string; years: MedianYears }>({ ticker, years: 5 });
  const [dailyData, setDailyData] = useState<{ ticker: string; daily: DailyValuation[] } | null>(null);
  const [peData, setPeData] = useState<{ ticker: string; daily: AdjustedPeDay[] | null } | null>(null);
  const metric = adjustedPe ? "Adjusted TTM P/E" : "EV/NOPAT";
  const loadDaily = !adjustedPe && !loading && snapshot?.ticker === ticker && snapshot.valuationReview === true &&
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

  useEffect(() => {
    if (!adjustedPe || !loadAdjustedHistory) return;
    const controller = new AbortController();
    fetch(`/api/stock/${encodeURIComponent(ticker)}/adjusted-pe`, { signal: controller.signal, cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Adjusted P/E unavailable");
        const { daily } = await response.json() as { daily: AdjustedPeDay[] };
        if (!controller.signal.aborted) setPeData({ ticker, daily });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPeData({ ticker, daily: null });
      });
    return () => controller.abort();
  }, [adjustedPe, loadAdjustedHistory, ticker]);

  if (!adjustedPe && !loading && snapshot?.valuationHasNegativeOperatingIncome) {
    return (
      <article className={panelClass} aria-labelledby={id + "-title"}>
        <GapReporter gap={null} onGapChange={onGapChange} />
        <h3 id={id + "-title"}>EV/NOPAT</h3>
        <p className="valuation-caption" role="status">
          Can’t calculate data for this stock because trailing 12-month operating income was negative.
        </p>
      </article>
    );
  }

  if (!adjustedPe && !loading && snapshot?.valuationHidden) {
    return (
      <article className={panelClass} aria-labelledby={id + "-title"}>
        <GapReporter gap={null} onGapChange={onGapChange} />
        <h3 id={id + "-title"}>{metric}</h3>
        <p className="valuation-caption" role="status">EV/NOPAT history is unavailable for this stock.</p>
      </article>
    );
  }

  const quarterly = adjustedPe ? [] : snapshot?.valuationPoints ?? [];
  const daily = loadDaily && dailyData?.ticker === ticker ? dailyData.daily : [];
  const peDays = adjustedPe && peData?.ticker === ticker ? peData.daily ?? [] : [];
  const dailyPoints = adjustedPe ? peDays.map(({ date, quarter, close, adjustedEps, pe }) => ({
    date, point: pe == null ? null : { quarter, close, value: pe, adjustedEps },
  })) : daily.map(({ date, point }) => ({
    date, point: point ? { ...point, value: point.ev_nopat } : null,
  }));
  const dailyAvailable = dailyPoints.filter(({ point }) => point !== null).length >= 2;
  const lastDailyIndex = dailyPoints.findLastIndex(({ point }) => point !== null);
  // Follow the latest run of usable values back to the first missing value or long trading gap.
  const lastDailyBreak = dailyAvailable ? dailyPoints.slice(0, lastDailyIndex).findLastIndex(({ date, point }, index) =>
    !point || Date.parse(dailyPoints[index + 1].date) - Date.parse(date) > 7 * DAY_MS) : -1;
  const series = dailyAvailable ? dailyPoints.slice(lastDailyBreak + 1, lastDailyIndex + 1).flatMap(({ date, point }) =>
    point ? [{ ...point, date }] : []) : quarterly.map((point) => ({ ...point, value: point.ev_nopat, date: point.quarter }));
  const ranges = availableChartRanges(series.map(({ date }) => date), RANGE_OPTIONS, (preset) => RANGE_MONTHS[preset],
    dailyAvailable ? (lastDailyBreak < 0 ? 4 : 0) : 7, dailyAvailable ? 0 : 7);
  const selectedRange = rangeSelection.ticker === ticker ? rangeSelection.range : DEFAULT_CHART_RANGE;
  const visibleRange = ranges.find(({ range }) => range === selectedRange) ?? ranges.at(-1);
  const range = visibleRange?.range;
  const visibleSeries = series.slice(visibleRange?.start ?? 0);
  const quarters = visibleSeries.map((point) => ({
    quarter: point.date, financialQuarter: point.quarter,
    value: point.value, price: point.close,
    nopat: "nopat" in point ? point.nopat : null,
    adjustedEps: "adjustedEps" in point ? point.adjustedEps : null,
    sharesEstimated: "sharesEstimated" in point && point.sharesEstimated,
    earningsRelease: "earningsRelease" in point && point.earningsRelease,
    debtEstimate: "debtEstimate" in point ? point.debtEstimate : undefined,
  }));
  const count = quarters.length;
  const tenYearMedianAvailable = adjustedPe || snapshot?.valuationAverageYears === 10;
  const medianYears = medianSelection.ticker === ticker && tenYearMedianAvailable ? medianSelection.years : 5;
  const medianLabel = `${medianYears}Y median`;
  const benchmarkPoints = adjustedPe ? peDays.map(({ date, pe }) => ({ date, value: pe }))
    : quarterly.map(({ quarter, ev_nopat }) => ({ date: quarter, value: ev_nopat }));
  const benchmarkEnd = Date.parse(benchmarkPoints.at(-1)?.date ?? "");
  const benchmarkStart = monthsBefore(new Date(benchmarkEnd), medianYears * 12).getTime();
  const benchmarkSample = benchmarkPoints.filter(({ date }) =>
    adjustedPe ? Date.parse(date) >= benchmarkStart : Date.parse(date) > benchmarkStart);
  const benchmarkValues = benchmarkSample.flatMap(({ value }) => value != null && Number.isFinite(value) ? [value] : [])
    .sort((a, b) => a - b);
  const midpoint = Math.floor(benchmarkValues.length / 2);
  const median = benchmarkValues.length === 0 ? null : benchmarkValues.length % 2 === 0
    ? (benchmarkValues[midpoint - 1] + benchmarkValues[midpoint]) / 2 : benchmarkValues[midpoint];
  const review = adjustedPe || snapshot?.valuationReview === true;
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
  const currentAdjustedEps = peDays.at(-1)?.adjustedEps;
  if (!range || count < 2 || median == null) return (
    <article className={panelClass} aria-labelledby={id + "-title"}>
      <GapReporter gap={null} onGapChange={onGapChange} />
      <h3 id={id + "-title"}>{metric}</h3>
      <p className="valuation-caption" role="status">
        {adjustedPe ? peData?.ticker !== ticker ? "Loading adjusted P/E history…"
          : peData.daily == null ? "Adjusted P/E history couldn’t load."
          : currentAdjustedEps != null && currentAdjustedEps <= 0
            ? "P/E is unavailable because trailing 12-month adjusted EPS is zero or negative."
          : "Insufficient price or adjusted EPS history for this stock."
          : loading ? "Loading valuation history…" : "EV/NOPAT history is unavailable for this stock."}
      </p>
    </article>
  );
  const selectedIndex = quarters.findIndex(({ quarter }) => quarter === hovered);
  const active = selectedIndex < 0 ? count - 1 : selectedIndex;
  const values = quarters.map(({ value }) => value);
  const historyValues = series.map(({ value }) => value);
  const low = Math.min(...historyValues);
  const high = Math.max(...historyValues);
  const latest = quarters[count - 1];
  const latestQuarter = quarterly.at(-1);
  const current = quarters[active];
  const currentComparison = adjustedPe ? peDays.at(-1)?.pe : dailyAvailable ? latest.value : review ? snapshot?.evNopat : null;
  const comparison = currentComparison ?? latestQuarter?.ev_nopat;
  const difference = comparison == null ? 0 : (comparison / median - 1) * 100;
  // Keep the exact boundaries inclusive despite floating-point noise.
  const comparisonPercent = Number(difference.toFixed(10));
  const valuationSide = comparisonPercent < -FAIR_VALUE_PERCENT ? "below"
    : comparisonPercent > FAIR_VALUE_PERCENT ? "above" : "fair";
  const showsBadge = adjustedPe ? currentComparison != null : dailyAvailable || !currentCannotCalculate;
  const tickIndexes = [...new Set(Array.from({ length: 5 }, (_, i) => Math.round(i * (count - 1) / 4)))];

  const { min, max, step: tickStep } = fittedChartAxis(Math.min(median, ...values), Math.max(median, ...values), 7);
  const tickDecimals = tickStep.toFixed(12).replace(/0+$/, "").split(".")[1]?.length ?? 0;
  const yTicks = Array.from({ length: Math.round((max - min) / tickStep) + 1 }, (_, index) => {
    const value = Number((min + index * tickStep).toFixed(tickDecimals));
    return { value, label: fmt(value, tickDecimals) + "x" };
  });
  const longestTick = Math.max(...yTicks.map(({ label }) => label.length));
  const left = 46 + Math.max(0, longestTick - 4) * 13;
  const right = 784;
  const top = 24;
  const height = paired ? plotHeight : DEFAULT_PLOT_HEIGHT;
  const bottom = height - 30;
  const dateLabelY = height - 6;
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
  const x = (index: number) => review ? dateX(dates[index]) : left + index * step;
  const visibleGaps = !dailyAvailable && review ? (snapshot?.unavailableValuationQuarters ?? []).filter(({ quarter }) => {
    const date = Date.parse(quarter);
    return date >= firstDate && date <= chartEnd;
  }) : [];
  const activeGap = visibleGaps.find(({ quarter }) => quarter === hovered);
  const activeDate = activeGap?.quarter ?? current.quarter;
  const detailNotes = activeGap ? [activeGap.detail] : [
    current.earningsRelease && "Earnings release",
    current.sharesEstimated && "Estimated shares",
    current.debtEstimate && (current.debtEstimate.method === "assumed-zero" ? "Debt assumed $0" : "Debt carried forward"),
  ].filter(Boolean);
  const activeX = activeGap ? dateX(Date.parse(activeGap.quarter)) : x(active);
  const hitTargets = [
    ...quarters.map(({ quarter }, index) => ({ quarter, x: x(index), gap: false })),
    ...visibleGaps.map(({ quarter }) => ({ quarter, x: dateX(Date.parse(quarter)), gap: true })),
  ].sort((a, b) => a.x - b.x);
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const baseline = y(median);
  const segments: { start: number; end: number; path: string }[] = [];
  for (const [index, value] of values.entries()) {
    const segment = segments.at(-1);
    const startsNewSegment = !dailyAvailable && review && index > 0 &&
      !isFiscalQuarterGap((dates[index] - dates[index - 1]) / DAY_MS);
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
  const firstBenchmarkPeDate = adjustedPe ? benchmarkSample.find(({ value }) => value != null && Number.isFinite(value))?.date : undefined;
  const historyNotes = adjustedPe ? [
    firstBenchmarkPeDate && Date.parse(firstBenchmarkPeDate) - benchmarkStart > 31 * DAY_MS &&
      `${medianLabel} uses data from ${VALUATION_MONTH_FORMAT.format(Date.parse(firstBenchmarkPeDate))}`,
  ].filter(Boolean) : [
    currentComparison == null && !currentCannotCalculate && "Badge uses latest quarter-end EV/NOPAT",
    !dailyAvailable && (loadDaily && dailyData?.ticker !== ticker
      ? "Loading daily valuation history…" : loadDaily ? "Daily history unavailable · Showing quarterly history" : "Quarterly history"),
    benchmarkValues.length < medianYears * 4 &&
      `${medianLabel} uses ${benchmarkValues.length} available quarters`,
    quarters.some(({ debtEstimate }) => debtEstimate) && "Includes estimated debt",
  ].filter(Boolean);

  return (
    <article className={panelClass} aria-labelledby={id + "-title"}>
      <GapReporter gap={showsBadge ? difference : null} onGapChange={onGapChange} />
      <div className="valuation-header">
        <div>
          <h3 id={id + "-title"}>{metric}</h3>
          {showsBadge && <div className="valuation-status-row" data-side={valuationSide}>
            <div className="valuation-status">{VALUATION_STATUS[valuationSide]}</div>
            <span className="valuation-badge">
              {difference > 0 ? "+" : ""}
              {fmt(difference, 1)}% vs {medianLabel}
            </span>
          </div>}
        </div>
        <ChartRangeControl range={range} options={ranges.map(({ range }) => range)} label={metric + " chart range"} onChange={(item) => {
          setHovered(null);
          setRangeSelection({ ticker, range: item });
        }} />
      </div>
      <div className="valuation-meta">
        {adjustedPe && currentComparison == null ? <p className="valuation-caption">
          Current adjusted P/E unavailable.
        </p> : dailyAvailable ? (
          <p className="valuation-caption">
            Latest {metric} <strong>{multiple(latest.value)}</strong>
            {" · Close as of "}
            <time dateTime={latest.quarter}>{VALUATION_CLOSE_FORMAT.format(Date.parse(latest.quarter))}</time>
          </p>
        ) : currentMultiple}
        <div className="valuation-median">
          <span>Median</span>
          <div className="valuation-median-control" role="group" aria-label={metric + " median window"}>
            {MEDIAN_WINDOWS.map((years) => (
              <button type="button" key={years} aria-pressed={medianYears === years}
                disabled={years === 10 && !tenYearMedianAvailable}
                title={years === 10 && !tenYearMedianAvailable ? "10-year EV/NOPAT history unavailable" : undefined}
                onClick={() => setMedianSelection({ ticker, years })}>
                {years}Y
              </button>
            ))}
          </div>
        </div>
      </div>
      {historyNotes.length > 0 && <p className="valuation-caption">{historyNotes.join(" · ")}</p>}

      <svg
        ref={plotRef}
        className="valuation-plot"
        viewBox={`0 0 ${PLOT_WIDTH} ${height}`}
        role="img"
        aria-label={`${ticker} ${metric} over ${count} ${dailyAvailable ? "trading days" : "quarters"} with a dashed ${medianYears}-year ${adjustedPe ? "daily" : "quarterly"} median`}
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
        {yTicks.map(({ value, label }) => {
          return (
            <g key={value}>
              <line className="valuation-gridline" x1={left} x2={right} y1={y(value)} y2={y(value)} />
              <text x={left - 7} y={y(value)} textAnchor="end" dominantBaseline="middle">
                {label}
              </text>
            </g>
          );
        })}
        {review ? tickIndexes.map((_, index) => {
          const progress = index / (tickIndexes.length - 1);
          const date = new Date(firstDate + dateSpan * progress);
          return <text key={index} x={dateX(date.getTime())} y={dateLabelY} textAnchor={progress === 0 ? "start" : progress === 1 ? "end" : "middle"}>
            {dateSpan >= 4 * 365 * DAY_MS ? date.getUTCFullYear()
              : range === "3M" || range === "6M" || (range === "MAX" && dateSpan <= 180 * DAY_MS) ? VALUATION_DAY_FORMAT.format(date)
                : VALUATION_MONTH_FORMAT.format(date)}
          </text>;
        }) : tickIndexes.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={dateLabelY}
            textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
          >
            {quarterLabelFromEnd(quarters[index].quarter).slice(-4)}
          </text>
        ))}
        <line className="valuation-average" x1={left} x2={right} y1={baseline} y2={baseline} />
        <ChartReveal key={range} quick={range !== "10Y"} left={left} right={right} top={top} bottom={bottom}>
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
        <span>{metric} by {dailyAvailable ? "trading day" : "quarter"}</span>
        <span>{medianYears}Y {adjustedPe ? "daily" : "quarterly"} median · {multiple(median)}</span>
      </div>
      <dl className="valuation-summary valuation-details" data-adjusted-pe={adjustedPe || undefined}>
        <div>
          <dt>{dailyAvailable ? "Date" : "Quarter"}</dt>
          <dd>{dailyAvailable ? VALUATION_CLOSE_FORMAT.format(Date.parse(activeDate)) : quarterLabelFromEnd(activeDate)}</dd>
        </div>
        <div>
          <dt>{metric}</dt>
          <dd>{activeGap ? activeGap.kind === "nonpositive-nopat" ? "Can’t calculate" : "Data unavailable" : multiple(current.value)}</dd>
        </div>
        {!adjustedPe && <div>
          <dt>Price</dt>
          <dd>{activeGap ? "—" : "$" + fmt(current.price, 2)}</dd>
        </div>}
        <div>
          <dt>{adjustedPe ? "Adjusted TTM EPS" : "TTM NOPAT"}</dt>
          <dd>{activeGap ? "—" : adjustedPe
            ? current.adjustedEps == null ? "—" : "$" + fmt(current.adjustedEps, 2)
            : current.nopat == null ? "—" : "$" + fmt(current.nopat, 1) + "B"}</dd>
        </div>
      </dl>
      {detailNotes.length > 0 && <p className="valuation-caption">{detailNotes.join(" · ")}</p>}

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
          <dt>Current vs {medianLabel}</dt>
          <dd>
            {currentComparison == null ? "Data unavailable" : `${multiple(currentComparison)} vs ${multiple(median)}`}
          </dd>
        </div>
        <div>
          <dt>Latest quarter</dt>
          <dd>{quarterLabelFromEnd(latestQuarter?.quarter ?? latest.financialQuarter)}</dd>
        </div>
      </dl>
    </article>
  );
}
