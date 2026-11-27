"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { CompanySnapshot } from "@/lib/companyData";
import type { ReportingCurrency } from "@/lib/edgar";
import { fmt } from "@/lib/market";
import { useCompanySnapshot } from "@/lib/useCompanyData";

const PERIODS = [1, 2, 5, 10, 15] as const;
type Period = (typeof PERIODS)[number];
type Unit = "billions" | "perShare" | "percent";

function quarterLabelFromEnd(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  if (!Number.isFinite(d.getTime())) return iso;
  const month = d.getUTCMonth();
  const q = Math.floor(month / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}

function formatValue(value: number, unit: Unit, decimals = 2, currency: ReportingCurrency = "USD") {
  if (unit === "percent") return fmt(value, decimals) + "%";
  return (value < 0 ? "-" : "") + (currency === "EUR" ? "€" : "$")
    + fmt(Math.abs(value), decimals) + (unit === "billions" ? "B" : "");
}

function metricAxis(values: number[]) {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = high - low || 1;
  const targetStep = span / 5;
  const exponent = Math.floor(Math.log10(targetStep));
  const magnitude = 10 ** exponent;
  const multiplier = [1, 2, 2.5, 5, 10].find((size) => size >= targetStep / magnitude) ?? 10;
  const interval = multiplier * magnitude;
  const first = Math.floor(low / interval);
  const last = Math.ceil((high === low ? 1 : high) / interval);
  const roundedMin = first * interval;
  const roundedMax = last * interval;
  // Prefer a round edge when it closely matches the data, otherwise fit the edge to the bar.
  const min = low - roundedMin <= span * 0.02 ? roundedMin : low;
  const max = high === low ? 1 : roundedMax - high <= span * 0.02 ? roundedMax : high;
  const ticks = Array.from({ length: last - first + 1 }, (_, index) => (first + index) * interval)
    .filter((value) => value - min >= interval * 0.65 && max - value >= interval * 0.65);
  const decimals = Math.min(12, Math.max(0, -exponent + (multiplier === 2.5 ? 1 : multiplier === 10 ? -1 : 0)));
  return {
    min,
    max,
    ticks: [min, ...ticks, max],
    decimals,
  };
}

function periodStart(latest: string, years: Period) {
  return `${Number(latest.slice(0, 4)) - years}${latest.slice(4)}`;
}

function periodChange(values: number[], dates: string[], years: Period, unit: Unit) {
  const latestDate = dates.at(-1);
  const latest = values.at(-1);
  if (!latestDate || latest == null) return null;
  const latestMs = Date.parse(latestDate);
  const target = Date.parse(periodStart(latestDate, years));
  if (!Number.isFinite(latestMs) || !Number.isFinite(target)) return null;

  // Find the closest available TTM point to the N-year anniversary.
  let index = -1;
  let best = Infinity;
  for (let i = 0; i < dates.length; i++) {
    const diff = Math.abs(Date.parse(dates[i]) - target);
    if (diff < best) {
      best = diff;
      index = i;
    }
  }
  if (index < 0) return null;

  // Allow fiscal drift; longer windows get more slack so early-history edges still count.
  const maxDriftDays = years >= 10 ? 220 : years >= 5 ? 140 : 100;
  if (best > maxDriftDays * 86_400_000) return null;

  const start = values[index];
  const startMs = Date.parse(dates[index]);
  if (unit === "percent") return latest - start;
  if (!(start > 0) || !(latest > 0) || !Number.isFinite(startMs)) return null;

  // CAGR over the actual elapsed span so a 15Y button still works when the
  // earliest comparable quarter is a few months off the exact anniversary.
  const actualYears = (latestMs - startMs) / (365.25 * 86_400_000);
  if (actualYears < years * 0.82 || actualYears > years * 1.18) return null;
  return ((latest / start) ** (1 / actualYears) - 1) * 100;
}

function formatChange(value: number, unit: Unit) {
  return (value > 0 ? "+" : "") + fmt(value, 1) + (unit === "percent" ? " pp" : "%");
}

function MetricChart({ label, values, dates, unit, currency, activeIndex, previewIndex, onPreview, onSelect, expanded = false }: {
  label: string;
  values: number[];
  dates: string[];
  unit: Unit;
  currency: ReportingCurrency;
  activeIndex: number;
  previewIndex: number | null;
  onPreview: (index: number | null) => void;
  onSelect: (index: number) => void;
  expanded?: boolean;
}) {
  const [keyboardActive, setKeyboardActive] = useState(false);
  const highlightedIndex = previewIndex ?? (keyboardActive ? activeIndex : null);
  const left = 53;
  const right = 373;
  const top = 14;
  const bottom = 191;
  const step = (right - left) / Math.max(1, values.length);
  const axis = metricAxis(values);
  const yAt = (value: number) => bottom - (value - axis.min) / (axis.max - axis.min) * (bottom - top);
  const zero = yAt(0);
  const tickCount = expanded && values.length >= 7 ? 7 : Math.min(values.length, 4);

  function browseQuarters(event: KeyboardEvent<SVGSVGElement>) {
    const last = values.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = Math.max(0, activeIndex - 1); break;
      case "ArrowRight": next = Math.min(last, activeIndex + 1); break;
      case "Home": next = 0; break;
      case "End": next = last; break;
      default: return;
    }
    event.preventDefault();
    setKeyboardActive(true);
    onPreview(null);
    onSelect(next);
  }

  return (
    <svg className="fundamental-plot" viewBox="0 0 384 220" role="group" tabIndex={0}
      aria-label={label + " by quarter. Use the arrow keys to select a quarter."}
      onKeyDown={browseQuarters} onBlur={() => setKeyboardActive(false)}>
      {axis.ticks.map((value, index) => {
        const y = yAt(value);
        return <g key={index}>
          <line x1={left} x2={right} y1={y} y2={y} />
          <text x={left - 5} y={y} textAnchor="end" dominantBaseline="middle">
            {formatValue(value, unit, Math.abs(value - Number(value.toFixed(axis.decimals))) < 1e-10
              ? axis.decimals : Math.min(12, axis.decimals + 2), currency)}
          </text>
        </g>;
      })}
      <g onPointerLeave={() => onPreview(null)}>
        {values.map((value, index) => {
          const y = yAt(value);
          const x = left + index * step;
          return (
            <g key={index} onPointerEnter={() => { setKeyboardActive(false); onPreview(index); }} onClick={() => onSelect(index)}>
              <rect className="fundamental-bar" data-active={index === highlightedIndex}
                x={x} y={Math.min(y, zero)} width={step * 0.8} height={Math.abs(y - zero)} rx={Math.min(2, step / 4)} />
              <rect className="fundamental-bar-target" x={x} y={top} width={step} height={bottom - top} />
            </g>
          );
        })}
      </g>
      {Array.from({ length: tickCount }, (_, tick) => {
        const lastTick = tick === tickCount - 1;
        const index = Math.round(tick * (values.length - 1) / (tickCount - 1));
        const x = lastTick ? right : left + index * step;
        return <text key={tick} x={x} y={210} data-extra-tick={tickCount === 7 && tick % 2 === 1}
          textAnchor={tick === 0 ? "start" : lastTick ? "end" : "middle"}>
          {dates[index] ? quarterLabelFromEnd(dates[index]) : ""}
        </text>;
      })}
    </svg>
  );
}

function MetricCard({ label, values, dates, unit, currency, sourceNote }: {
  label: string; values: number[]; dates: string[]; unit: Unit; currency: ReportingCurrency; sourceNote: string;
}) {
  const dialogId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [period, setPeriod] = useState<Period>(15);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const latestDate = dates.at(-1);
  const cutoff = latestDate ? Date.parse(periodStart(latestDate, period)) - 7 * 86_400_000 : null;
  const start = cutoff === null ? 0 : Math.max(0, dates.findIndex((date) => Date.parse(date) >= cutoff));
  const displayedValues = values.slice(start);
  const last = displayedValues.length - 1;
  const activeIndex = Math.min(preview ?? selected ?? last, last);
  const displayedDates = dates.slice(start);
  const quarter = displayedDates[activeIndex] ? quarterLabelFromEnd(displayedDates[activeIndex]) : null;
  const title = label.replace(/^TTM\s+/, "");

  function selectPeriod(years: Period) {
    if (years === period) return;
    setPeriod(years);
    setPreview(null);
    setSelected(null);
  }

  if (displayedValues.length < 2) {
    return (
      <article className="panel fundamental-card">
        <header className="fundamental-card-header">
          <div><h3>{label.replace(/^TTM\s+/, "")}</h3><p>{sourceNote}</p></div>
        </header>
        <p className="fundamental-range-label">Not enough filing history yet.</p>
      </article>
    );
  }

  function chart(isExpanded: boolean) {
    return <MetricChart label={label} values={displayedValues} dates={displayedDates} unit={unit} currency={currency}
      activeIndex={activeIndex} previewIndex={preview} onPreview={setPreview} onSelect={setSelected} expanded={isExpanded} />;
  }

  const periodControls = (
      <div className="fundamental-ranges" role="group" aria-label={label + " chart period"}>
        {PERIODS.map((years) => {
          const change = periodChange(values, dates, years, unit);
          return <button key={years} type="button" aria-pressed={years === period} onClick={() => selectPeriod(years)}>
            <span>{years}Y</span>
            <strong className={change == null ? undefined : change < 0 ? "chg-dn" : "chg-up"}>
              {change == null ? "—" : formatChange(change, unit)}
            </strong>
          </button>;
        })}
      </div>
  );

  return (
    <article className="panel fundamental-card">
      <header className="fundamental-card-header">
        <div><h3>{title}</h3><p>{quarter ?? sourceNote} · TTM</p></div>
        <button type="button" className="fundamental-chart-action" aria-haspopup="dialog"
          aria-controls={dialogId} aria-label={"Expand " + title + " chart"}
          onClick={() => {
            dialogRef.current?.showModal();
            setPreview(null);
            setExpanded(true);
          }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5M4 4l5 5m11-5l-5 5m5 11-5-5M4 20l5-5" />
          </svg>
        </button>
      </header>
      <strong className="fundamental-value">{formatValue(displayedValues[activeIndex], unit, 2, currency)}</strong>
      {chart(false)}
      <p className="fundamental-range-label">{unit === "percent" ? "Margin change" : "Compound annual growth"}</p>
      {periodControls}

      <dialog id={dialogId} ref={dialogRef} className="fundamental-dialog" aria-labelledby={dialogId + "-title"}
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
        onClose={() => { setExpanded(false); setPreview(null); }}>
        <div className="fundamental-dialog-content">
          <header className="fundamental-card-header">
            <div>
              <h2 id={dialogId + "-title"}>Quarterly {label}</h2>
              <p>Trailing 12 months · {sourceNote}</p>
            </div>
            <button type="button" className="fundamental-chart-action" aria-label={"Close " + title + " chart"}
              onClick={() => dialogRef.current?.close()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>
          {expanded && <>
            <div className="fundamental-dialog-value">
              {quarter && <span>{quarter}</span>}
              <strong className="fundamental-value">{formatValue(displayedValues[activeIndex], unit, 2, currency)}</strong>
            </div>
            {chart(true)}
            <p className="fundamental-range-label">{unit === "percent" ? "Margin change" : "Compound annual growth"}</p>
            {periodControls}
          </>}
        </div>
      </dialog>
    </article>
  );
}

export function FundamentalSummary({ ticker }: { ticker: string }) {
  const { snapshot, loading } = useCompanySnapshot(ticker);
  const s = snapshot?.sources.fundamentals === "edgar" ? snapshot : null;
  const items = [
    { label: "TTM Revenue", value: s?.revBillions, unit: "billions" as const },
    { label: "TTM Diluted EPS", value: s?.epsTtm, unit: "perShare" as const },
    { label: "TTM Operating Income", value: s?.opincBillions, unit: "billions" as const },
  ];

  return (
    <dl className="panel fundamental-summary" aria-label="Fundamentals summary">
      {items.map(({ label, value, unit }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{loading && value == null ? "…" : value == null ? "Data unavailable" : formatValue(value, unit, 2, s?.reportingCurrency)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Fundamentals({ ticker, snapshot, loading }: {
  ticker: string;
  snapshot: CompanySnapshot | null;
  loading: boolean;
}) {
  if (loading && !snapshot) return <p className="panel" role="status">Loading quarterly filings…</p>;
  if (snapshot?.sources.fundamentals !== "edgar") return <p className="panel">Data unavailable. No quarterly filings for {ticker}.</p>;
  const sourceNote = "SEC filings";
  const revenue = snapshot.revenueHistory;
  const operatingIncome = snapshot.operatingIncomeHistory;
  const eps = snapshot.epsHistory;
  const cashFlow = snapshot.fcfHistory;
  const dates = snapshot.filingDates;
  const revenueByDate = new Map((dates?.revenue ?? []).map((date, index) => [date, revenue[index]]));
  function margin(values: number[], quarters: string[]) {
    const points = quarters.flatMap((date, index) => {
      const sales = revenueByDate.get(date);
      return sales ? [{ date, value: values[index] / sales * 100 }] : [];
    });
    return { dates: points.map(({ date }) => date), values: points.map(({ value }) => value) };
  }

  const metrics = [
    { label: "TTM Revenue", values: revenue, dates: dates?.revenue ?? [], unit: "billions" as const },
    { label: "TTM Diluted EPS", values: eps, dates: dates?.eps ?? [], unit: "perShare" as const },
    { label: "TTM Operating Income", values: operatingIncome, dates: dates?.operatingIncome ?? [], unit: "billions" as const },
    { label: "TTM Free Cash Flow", values: cashFlow, dates: dates?.fcf ?? [], unit: "billions" as const },
    {
      label: "TTM Operating Margin",
      ...margin(operatingIncome, dates?.operatingIncome ?? []),
      unit: "percent" as const,
    },
    {
      label: "TTM Free Cash Flow Margin",
      ...margin(cashFlow, dates?.fcf ?? []),
      unit: "percent" as const,
    },
  ];

  return (
    <div className="fundamental-grid">
      {metrics.map((metric) => (
        <MetricCard key={metric.label} {...metric} currency={snapshot.reportingCurrency ?? "USD"} sourceNote={sourceNote} />
      ))}
    </div>
  );
}

// Keep export for any leftover imports of quarter helpers in other files.
export { quarterLabelFromEnd };
