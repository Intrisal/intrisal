"use client";

import { useState, type KeyboardEvent } from "react";
import { fmt, sample } from "@/lib/market";
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

function formatValue(value: number, unit: Unit, decimals = 2) {
  if (unit === "percent") return fmt(value, decimals) + "%";
  return "$" + fmt(value, decimals) + (unit === "billions" ? "B" : "");
}

function periodChange(values: number[], years: Period, unit: Unit) {
  if (values.length < years * 4 + 1) return 0;
  const latest = values[values.length - 1];
  const start = values[values.length - 1 - years * 4];
  if (!start) return 0;
  return unit === "percent" ? latest - start : ((latest / start) ** (1 / years) - 1) * 100;
}

function formatChange(value: number, unit: Unit) {
  return (value > 0 ? "+" : "") + fmt(value, 1) + (unit === "percent" ? " pp" : "%");
}

function padHistory(values: number[], minLen: number) {
  if (values.length >= minLen) return values;
  if (!values.length) return values;
  const first = values[0];
  return [...Array(minLen - values.length).fill(first), ...values];
}

function MetricChart({ label, values, unit, activeIndex, previewIndex, onPreview, onSelect }: {
  label: string;
  values: number[];
  unit: Unit;
  activeIndex: number;
  previewIndex: number | null;
  onPreview: (index: number | null) => void;
  onSelect: (index: number) => void;
}) {
  const [keyboardActive, setKeyboardActive] = useState(false);
  const highlightedIndex = previewIndex ?? (keyboardActive ? activeIndex : null);
  const left = 53;
  const right = 373;
  const top = 14;
  const bottom = 191;
  const step = (right - left) / Math.max(1, values.length);
  const peak = Math.max(...values, 0.01);
  const magnitude = 10 ** Math.floor(Math.log10(peak / 4));
  const interval = Math.ceil(peak / (4 * magnitude)) * magnitude;
  const max = interval * 4;
  const axisDecimals = Math.max(0, -Math.floor(Math.log10(interval || 1)));

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
      {[0, 1, 2, 3, 4].map((tick) => {
        const y = bottom - tick * (bottom - top) / 4;
        return <g key={tick}>
          <line x1={left} x2={right} y1={y} y2={y} />
          <text x={left - 5} y={y} textAnchor="end" dominantBaseline="middle">{formatValue(tick * interval, unit, axisDecimals)}</text>
        </g>;
      })}
      <g onPointerLeave={() => onPreview(null)}>
        {values.map((value, index) => {
          const height = value / max * (bottom - top);
          const x = left + index * step;
          return (
            <g key={index} onPointerEnter={() => { setKeyboardActive(false); onPreview(index); }} onClick={() => onSelect(index)}>
              <rect className="fundamental-bar" data-active={index === highlightedIndex}
                x={x} y={bottom - height} width={step * 0.8} height={Math.max(0, height)} rx={Math.min(2, step / 4)} />
              <rect className="fundamental-bar-target" x={x} y={top} width={step} height={bottom - top} />
            </g>
          );
        })}
      </g>
      {[0, 1, 2, 3].map((tick) => {
        const index = Math.round(tick * (values.length - 1) / 3);
        const x = tick === 3 ? right : left + index * step;
        return <text key={tick} x={x} y={210} textAnchor={tick === 0 ? "start" : tick === 3 ? "end" : "middle"}>
          {tick === 3 ? "Latest" : `${values.length - 1 - index}q ago`}
        </text>;
      })}
    </svg>
  );
}

function MetricCard({ label, values, unit, sourceNote }: { label: string; values: number[]; unit: Unit; sourceNote: string }) {
  const [period, setPeriod] = useState<Period>(5);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const needed = period * 4 + 1;
  const displayedValues = values.slice(-needed);
  const last = displayedValues.length - 1;
  const activeIndex = preview ?? selected ?? last;

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

  return (
    <article className="panel fundamental-card" data-expanded={expanded}>
      <header className="fundamental-card-header">
        <div><h3>{label.replace(/^TTM\s+/, "")}</h3><p>TTM · {sourceNote}</p></div>
        <button type="button" aria-expanded={expanded} aria-label={(expanded ? "Shrink " : "Expand ") + label} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Shrink" : "Expand"}
        </button>
      </header>
      <strong className="fundamental-value">{formatValue(displayedValues[activeIndex], unit)}</strong>
      <MetricChart label={label} values={displayedValues} unit={unit} activeIndex={activeIndex} previewIndex={preview}
        onPreview={setPreview} onSelect={setSelected} />
      {unit === "percent" && <p className="fundamental-range-label">Margin change</p>}
      <div className="fundamental-ranges" role="group" aria-label={label + " chart period"}>
        {PERIODS.map((years) => {
          const change = periodChange(padHistory(values, years * 4 + 1), years, unit);
          return <button key={years} type="button" aria-pressed={years === period} onClick={() => selectPeriod(years)}>
            <span>{years}Y</span>
            <strong className={change < 0 ? "chg-dn" : "chg-up"}>{formatChange(change, unit)}</strong>
          </button>;
        })}
      </div>
    </article>
  );
}

export function FundamentalSummary({ ticker }: { ticker: string }) {
  const { snapshot, loading } = useCompanySnapshot(ticker);
  const s = snapshot ?? null;
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
          <dd>{loading && value == null ? "…" : value == null ? "—" : formatValue(value, unit)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Fundamentals({ ticker }: { ticker: string }) {
  const { snapshot, loading } = useCompanySnapshot(ticker);
  const fallback = sample(ticker);
  const sourceNote = loading && !snapshot ? "Loading…" : "TTM";

  const revenue = snapshot?.revenueHistory?.length
    ? snapshot.revenueHistory
    : [fallback.rev * 0.7, fallback.rev * 0.8, fallback.rev * 0.9, fallback.rev];
  const operatingIncome = snapshot?.operatingIncomeHistory?.length
    ? snapshot.operatingIncomeHistory
    : [fallback.opinc * 0.7, fallback.opinc * 0.8, fallback.opinc * 0.9, fallback.opinc];
  const eps = snapshot?.epsHistory?.length
    ? snapshot.epsHistory
    : [fallback.eps * 0.7, fallback.eps * 0.8, fallback.eps * 0.9, fallback.eps];
  const cashFlow = snapshot?.fcfHistory?.length
    ? snapshot.fcfHistory
    : [fallback.fcf * 0.7, fallback.fcf * 0.8, fallback.fcf * 0.9, fallback.fcf];

  const metrics = [
    { label: "TTM Revenue", values: revenue, unit: "billions" as const },
    { label: "TTM Diluted EPS", values: eps, unit: "perShare" as const },
    { label: "TTM Operating Income", values: operatingIncome, unit: "billions" as const },
    { label: "TTM Free Cash Flow", values: cashFlow, unit: "billions" as const },
    {
      label: "TTM Operating Margin",
      values: operatingIncome.map((value, index) => (revenue[index] ? (value / revenue[index]) * 100 : 0)),
      unit: "percent" as const,
    },
    {
      label: "TTM Free Cash Flow Margin",
      values: cashFlow.map((value, index) => (revenue[index] ? (value / revenue[index]) * 100 : 0)),
      unit: "percent" as const,
    },
  ];

  return (
    <div className="fundamental-grid">
      {metrics.map((metric) => (
        <MetricCard key={metric.label} {...metric} sourceNote={sourceNote} />
      ))}
    </div>
  );
}

// Keep export for any leftover imports of quarter helpers in other files.
export { quarterLabelFromEnd };
