import { useState } from "react";
import { fmt, hashStr, rng, sample } from "@/lib/market";

const PERIODS = [1, 2, 5, 10, 15] as const;
type Period = (typeof PERIODS)[number];
type Unit = "billions" | "perShare" | "percent";
const LATEST_QUARTER = 2026 * 4 + 2;
const HISTORY_QUARTERS = 61;

function quarterLabel(quarter: number) {
  return "Q" + (quarter % 4 + 1) + " " + Math.floor(quarter / 4);
}

function formatValue(value: number, unit: Unit, decimals = 2) {
  if (unit === "percent") return fmt(value, decimals) + "%";
  return "$" + fmt(value, decimals) + (unit === "billions" ? "B" : "");
}

function history(ticker: string, metric: string, latest: number, annualGrowth: number) {
  const random = rng(hashStr(ticker + ":" + metric));
  return Array.from({ length: HISTORY_QUARTERS }, (_, index) => {
    const yearsAgo = (HISTORY_QUARTERS - 1 - index) / 4;
    const variation = 1 + (random() - 0.5) * 0.13 * Math.min(1, yearsAgo);
    return latest * variation / (1 + annualGrowth / 100) ** yearsAgo;
  });
}

function periodChange(values: number[], years: Period, unit: Unit) {
  const latest = values[values.length - 1];
  const start = values[values.length - 1 - years * 4];
  return unit === "percent" ? latest - start : ((latest / start) ** (1 / years) - 1) * 100;
}

function formatChange(value: number, unit: Unit) {
  return (value > 0 ? "+" : "") + fmt(value, 1) + (unit === "percent" ? " pp" : "%");
}

function MetricChart({ label, values, unit }: { label: string; values: number[]; unit: Unit }) {
  const left = 53;
  const right = 373;
  const top = 14;
  const bottom = 191;
  const step = (right - left) / values.length;
  const peak = Math.max(...values);
  const magnitude = 10 ** Math.floor(Math.log10(peak / 4));
  const interval = Math.ceil(peak / (4 * magnitude)) * magnitude;
  const max = interval * 4;
  const firstQuarter = LATEST_QUARTER - values.length + 1;
  const axisDecimals = Math.max(0, -Math.floor(Math.log10(interval)));
  return (
    <svg className="fundamental-plot" viewBox="0 0 384 220" role="img" aria-label={label + " by quarter, sample data"}>
      {[0, 1, 2, 3, 4].map((tick) => {
        const y = bottom - tick * (bottom - top) / 4;
        return <g key={tick}>
          <line x1={left} x2={right} y1={y} y2={y} />
          <text x={left - 5} y={y} textAnchor="end" dominantBaseline="middle">{formatValue(tick * interval, unit, axisDecimals)}</text>
        </g>;
      })}
      {values.map((value, index) => {
        const height = value / max * (bottom - top);
        return <rect key={index} x={left + index * step} y={bottom - height} width={step * 0.8} height={height} rx={Math.min(2, step / 4)}>
          <title>{quarterLabel(firstQuarter + index)} · {formatValue(value, unit)}</title>
        </rect>;
      })}
      {[0, 1, 2, 3].map((tick) => {
        const index = Math.round(tick * (values.length - 1) / 3);
        const x = tick === 3 ? right : left + index * step;
        return <text key={tick} x={x} y={210} textAnchor={tick === 0 ? "start" : tick === 3 ? "end" : "middle"}>
          {quarterLabel(firstQuarter + index)}
        </text>;
      })}
    </svg>
  );
}

function MetricCard({ label, values, unit }: { label: string; values: number[]; unit: Unit }) {
  const [period, setPeriod] = useState<Period>(15);
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="panel fundamental-card" data-expanded={expanded}>
      <header className="fundamental-card-header">
        <div><h3>{label.replace(/^TTM\s+/, "")}</h3><p>{quarterLabel(LATEST_QUARTER)} · TTM · Sample</p></div>
        <button type="button" aria-expanded={expanded} aria-label={(expanded ? "Shrink " : "Expand ") + label} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Shrink" : "Expand"}
        </button>
      </header>
      <strong className="fundamental-value">{formatValue(values[values.length - 1], unit)}</strong>
      <MetricChart label={label} values={values.slice(-(period * 4 + 1))} unit={unit} />
      {unit === "percent" && <p className="fundamental-range-label">Margin change</p>}
      <div className="fundamental-ranges" role="group" aria-label={label + " chart period"}>
        {PERIODS.map((years) => {
          const change = periodChange(values, years, unit);
          return <button key={years} type="button" aria-pressed={years === period} onClick={() => setPeriod(years)}>
            <span>{years}Y</span>
            <strong className={change < 0 ? "chg-dn" : "chg-up"}>{formatChange(change, unit)}</strong>
          </button>;
        })}
      </div>
    </article>
  );
}

function primaryMetrics(ticker: string, s = sample(ticker)) {
  return [
    { label: "TTM Revenue", values: history(ticker, "revenue", s.rev, s.growth), unit: "billions" },
    { label: "TTM Diluted EPS", values: history(ticker, "diluted-eps", s.eps, s.growth * 1.12), unit: "perShare" },
    { label: "TTM Operating Income", values: history(ticker, "operating-income", s.opinc, s.growth * 1.08), unit: "billions" },
  ] as const;
}

export function FundamentalSummary({ ticker }: { ticker: string }) {
  return (
    <dl className="panel fundamental-summary" aria-label={quarterLabel(LATEST_QUARTER) + " sample fundamentals"}>
      {primaryMetrics(ticker).map(({ label, values, unit }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{formatValue(values[values.length - 1], unit)}</dd>
          <dt className="fundamental-cagr-label">10Y CAGR</dt>
          <dd className="fundamental-cagr">{formatChange(periodChange(values, 10, unit), unit)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Fundamentals({ ticker }: { ticker: string }) {
  const s = sample(ticker);
  const primary = primaryMetrics(ticker, s);
  const revenue = primary[0].values;
  const operatingIncome = primary[2].values;
  const cashFlow = history(ticker, "free-cash-flow", s.fcf, s.growth * 0.94);
  const metrics = [
    ...primary,
    { label: "TTM Free Cash Flow", values: cashFlow, unit: "billions" },
    { label: "TTM Operating Margin", values: operatingIncome.map((value, index) => value / revenue[index] * 100), unit: "percent" },
    { label: "TTM Free Cash Flow Margin", values: cashFlow.map((value, index) => value / revenue[index] * 100), unit: "percent" },
  ] satisfies { label: string; values: number[]; unit: Unit }[];

  return (
    <div className="fundamental-grid">
      {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
    </div>
  );
}
