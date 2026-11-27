"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SIM_RANGES,
  allocatedAmount,
  buildPortfolioPath,
  cashAmount,
  hasTenYearPriceHistory,
  niceAxisTicks,
  type PriceSeries,
  type SimHolding,
  type SimRange,
  type SimState,
} from "@/lib/portfolioSim";
import { fmt, normalizeTicker } from "@/lib/market";
import type { StockHistory } from "@/lib/useMarketData";

function sanitizeSeries(history: StockHistory): PriceSeries {
  const dates: string[] = [];
  const closes: number[] = [];
  for (let i = 0; i < history.closes.length; i++) {
    const close = history.closes[i];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    dates.push(history.dates[i] ?? "");
    closes.push(close);
  }
  return { ticker: history.ticker, dates, closes };
}

function usePriceSeries(tickers: string[]) {
  const key = tickers.slice().sort().join(",");
  const [series, setSeries] = useState<Record<string, PriceSeries | null>>({});
  const [loading, setLoading] = useState(Boolean(key));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    if (!key) {
      setSeries({});
      setErrors({});
      setLoading(false);
      return;
    }
    const list = key.split(",");
    setLoading(true);
    Promise.all(
      list.map(async (ticker) => {
        try {
          const res = await fetch("/api/market/history?symbol=" + encodeURIComponent(ticker), { cache: "no-store" });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || res.statusText);
          return { ticker, data: sanitizeSeries(body as StockHistory), error: null as string | null };
        } catch (err) {
          return {
            ticker,
            data: null as PriceSeries | null,
            error: err instanceof Error ? err.message : "Failed to load",
          };
        }
      }),
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, PriceSeries | null> = {};
      const nextErrors: Record<string, string> = {};
      for (const row of rows) {
        next[row.ticker] = row.data;
        if (!row.data) nextErrors[row.ticker] = row.error || "No stored prices";
      }
      setSeries(next);
      setErrors(nextErrors);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { series, loading, errors };
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const YEAR_ONLY = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "UTC" });

function formatAxisMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return "$" + fmt(value / 1_000_000, 1) + "M";
  if (abs >= 10_000) return "$" + fmt(value / 1000, abs >= 100_000 ? 0 : 1) + "k";
  return "$" + fmt(value, value >= 100 ? 0 : 2);
}

function formatAxisDate(iso: string, range: SimRange) {
  const date = new Date(iso + "T00:00:00Z");
  return range === "10Y" || range === "5Y" ? YEAR_ONLY.format(date) : MONTH_YEAR.format(date);
}

function dateTickIndexes(length: number, count: number) {
  if (length <= 1) return [0];
  const ticks = Math.min(count, length);
  const indexes: number[] = [];
  for (let i = 0; i < ticks; i++) {
    indexes.push(Math.round((i * (length - 1)) / (ticks - 1)));
  }
  return [...new Set(indexes)];
}

function PortfolioChart({
  values,
  dates,
  range,
  capital,
  spyValues,
  showSpy,
}: {
  values: number[];
  dates: string[];
  range: SimRange;
  capital: number;
  spyValues?: number[] | null;
  showSpy: boolean;
}) {
  const w = 720;
  const h = 220;
  const padL = 52;
  const padR = 14;
  const padT = 10;
  const padB = 28;

  if (values.length < 2 || dates.length < 2) {
    return (
      <div className="sim-chart-empty">
        <p>Add tickers and capital on the right to simulate a portfolio.</p>
      </div>
    );
  }

  const scale = capital / 100;
  const dollarValues = values.map((v) => v * scale);
  const spyDollars = spyValues?.map((v) => v * scale) ?? null;
  const compared = showSpy && spyDollars && spyDollars.length === dollarValues.length
    ? [...dollarValues, ...spyDollars]
    : dollarValues;

  const min0 = Math.min(...compared, capital);
  const max0 = Math.max(...compared, capital);
  let span = max0 - min0 || 1;
  const min = min0 - span * 0.06;
  const max = max0 + span * 0.08;
  span = max - min;
  const yTicks = niceAxisTicks(min, max, 5);
  const xIndexes = dateTickIndexes(dates.length, range === "1Y" || range === "2Y" ? 5 : 6);

  function xAt(index: number) {
    return padL + ((w - padL - padR) * index) / (dollarValues.length - 1);
  }
  function yAt(value: number) {
    return padT + (h - padT - padB) * (1 - (value - min) / span);
  }

  function pathFor(data: number[]) {
    return data
      .map((v, i) => {
        const x = xAt(i);
        const y = yAt(v);
        return (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
      })
      .join(" ");
  }

  const d = pathFor(dollarValues);
  const lastX = xAt(dollarValues.length - 1);
  const lastY = yAt(dollarValues.at(-1)!);
  const baseY = yAt(capital);
  const area = d + " L" + lastX.toFixed(1) + " " + (h - padB) + " L" + padL.toFixed(1) + " " + (h - padB) + " Z";

  return (
    <svg className="sim-chart-svg" viewBox={"0 0 " + w + " " + h} role="img" aria-label="Portfolio value over time">
      {yTicks.map((tick) => {
        const y = yAt(tick);
        return (
          <g key={"y-" + tick}>
            <line x1={padL} x2={w - padR} y1={y} y2={y} className="sim-chart-grid" />
            <text x={padL - 8} y={y + 3.5} textAnchor="end" className="sim-chart-label">
              {formatAxisMoney(tick)}
            </text>
          </g>
        );
      })}
      {xIndexes.map((index) => {
        const x = xAt(index);
        return (
          <text key={"x-" + index} x={x} y={h - 10} textAnchor="middle" className="sim-chart-label">
            {formatAxisDate(dates[index]!, range)}
          </text>
        );
      })}
      <line x1={padL} x2={w - padR} y1={baseY} y2={baseY} className="sim-chart-base" />
      <path d={area} className="sim-chart-fill" />
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {showSpy && spyDollars && spyDollars.length === dollarValues.length ? (
        <path
          d={pathFor(spyDollars)}
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="1.6"
          strokeDasharray="5 4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      <circle cx={lastX} cy={lastY} r="3.5" fill="var(--ink)" />
    </svg>
  );
}

function clampAmount(value: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value * 100) / 100));
}

function clampCapital(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 100) / 100);
}

export function SimulationPanels({ sim, onSim }: { sim: SimState; onSim: (next: SimState) => void }) {
  const [draftTicker, setDraftTicker] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [capitalDraft, setCapitalDraft] = useState(String(sim.capital));

  useEffect(() => {
    setCapitalDraft(String(sim.capital));
  }, [sim.capital]);

  const tickers = sim.holdings.map((row) => row.ticker);
  const { series, loading, errors } = usePriceSeries(tickers);

  const path = useMemo(
    () => buildPortfolioPath(sim.capital, sim.holdings, series, sim.range),
    [sim.capital, sim.holdings, series, sim.range],
  );

  const invested = allocatedAmount(sim.holdings);
  const cash = cashAmount(sim.capital, sim.holdings);
  const remaining = Math.max(0, sim.capital - invested);
  const investedPct = sim.capital > 0 ? (invested / sim.capital) * 100 : 0;
  const cashPct = sim.capital > 0 ? (cash / sim.capital) * 100 : 100;

  async function addTicker() {
    const ticker = normalizeTicker(draftTicker);
    setAddError(null);
    if (!/^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/.test(ticker)) {
      setAddError("Enter a valid ticker.");
      return;
    }
    if (sim.holdings.some((row) => row.ticker === ticker)) {
      setAddError(ticker + " is already in the portfolio.");
      return;
    }
    if (remaining <= 0) {
      setAddError("No capital left. Raise total capital or free some allocation.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/market/history?symbol=" + encodeURIComponent(ticker), { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setAddError(body.error || "No stored prices for " + ticker);
        return;
      }
      const cleaned = sanitizeSeries(body as StockHistory);
      if (!hasTenYearPriceHistory(cleaned.dates)) {
        setAddError(ticker + " needs ~10Y of stored price data.");
        return;
      }
      const amount = Math.min(Math.max(100, Math.round(sim.capital * 0.1)), remaining);
      onSim({
        ...sim,
        holdings: [...sim.holdings, { ticker, amount }],
      });
      setDraftTicker("");
    } catch {
      setAddError("Could not verify prices for " + ticker);
    } finally {
      setAdding(false);
    }
  }

  function updateAmount(ticker: string, nextAmount: number) {
    const others = allocatedAmount(sim.holdings.filter((row) => row.ticker !== ticker));
    const max = Math.max(0, sim.capital - others);
    const amount = clampAmount(nextAmount, max);
    onSim({
      ...sim,
      holdings: sim.holdings.map((row) => (row.ticker === ticker ? { ...row, amount } : row)),
    });
  }

  function removeHolding(ticker: string) {
    onSim({ ...sim, holdings: sim.holdings.filter((row) => row.ticker !== ticker) });
  }

  function commitCapital(raw: string) {
    const parsed = clampCapital(parseFloat(raw));
    const nextCapital = parsed > 0 ? parsed : 0;
    const scale = sim.capital > 0 ? nextCapital / sim.capital : 0;
    const holdings = nextCapital <= 0
      ? sim.holdings.map((row) => ({ ...row, amount: 0 }))
      : sim.capital > 0
        ? sim.holdings.map((row) => ({ ...row, amount: clampAmount(row.amount * scale, nextCapital) }))
        : sim.holdings;
    // If scaling drifts over capital from rounding, trim from the end.
    let spent = allocatedAmount(holdings);
    let adjusted = holdings;
    if (spent > nextCapital && adjusted.length) {
      adjusted = adjusted.map((row) => ({ ...row }));
      for (let i = adjusted.length - 1; i >= 0 && spent > nextCapital; i--) {
        const overflow = spent - nextCapital;
        const cut = Math.min(adjusted[i]!.amount, overflow);
        adjusted[i]!.amount = clampAmount(adjusted[i]!.amount - cut, nextCapital);
        spent -= cut;
      }
    }
    onSim({ ...sim, capital: nextCapital, holdings: adjusted });
    setCapitalDraft(String(nextCapital));
  }

  function setRange(range: SimRange) {
    if (range !== sim.range) onSim({ ...sim, range });
  }

  const endPer100 = path?.endValue ?? 100;
  const endPortfolio = (endPer100 / 100) * sim.capital;
  const diffPer100 = path?.difference ?? 0;
  const diffPortfolio = endPortfolio - sim.capital;
  const valueTone = endPer100 > 100 ? "stock-positive" : endPer100 < 100 ? "stock-negative" : "";
  const diffTone = diffPer100 > 0 ? "stock-positive" : diffPer100 < 0 ? "stock-negative" : "";
  const cagr = path?.cagr ?? 0;
  const cagrTone = path ? (cagr >= 0 ? "stock-positive" : "stock-negative") : "";

  return (
    <article className="panel sim sim-workspace">
      <header className="sim-top">
        <h2>Simulation</h2>
        <div className="range-row sim-ranges" role="group" aria-label="Simulation range">
          {SIM_RANGES.map((item) => (
            <button key={item} type="button" aria-pressed={item === sim.range} onClick={() => setRange(item)}>
              {item}
            </button>
          ))}
        </div>
      </header>

      <div className="sim-body">
        <section className="sim-main" aria-label="Chart and holdings">
          <div className="sim-chart-box">
            {loading && sim.holdings.length > 0 ? (
              <div className="sim-chart-empty"><p>Loading prices…</p></div>
            ) : (
              <PortfolioChart
                values={path?.values?.length ? path.values : [100]}
                dates={path?.dates?.length ? path.dates : []}
                range={sim.range}
                capital={sim.capital > 0 ? sim.capital : 100}
                showSpy={sim.showSpy}
                spyValues={null}
              />
            )}
          </div>

          <div className="sim-builder">
            <div className="sim-builder-controls">
              <div className="sim-capital-block">
                <label className="sim-capital-label" htmlFor="simCapital">Capital</label>
                <div className="sim-capital-row">
                  <span aria-hidden="true">$</span>
                  <input
                    id="simCapital"
                    type="number"
                    min={0}
                    step={100}
                    value={capitalDraft}
                    onChange={(e) => setCapitalDraft(e.target.value)}
                    onBlur={() => commitCapital(capitalDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </div>
              </div>

              <form
                className="sim-add-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addTicker();
                }}
              >
                <label className="sr-only" htmlFor="simTicker">Ticker</label>
                <input
                  id="simTicker"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Add ticker"
                  value={draftTicker}
                  onChange={(e) => {
                    setDraftTicker(e.target.value.toUpperCase());
                    setAddError(null);
                  }}
                />
                <button type="submit" disabled={adding || remaining <= 0}>
                  {adding ? "…" : "Add"}
                </button>
              </form>

              <div className="sim-alloc-chip mono" title="Invested vs cash">
                <span>${fmt(invested, 0)} in</span>
                <span className="sim-alloc-sep">·</span>
                <span>${fmt(cash, 0)} cash</span>
              </div>
            </div>
            {addError ? <div className="sim-error" role="alert">{addError}</div> : null}

            <div className="sim-alloc-meter" aria-hidden="true">
              <span className="sim-alloc-invested" style={{ width: investedPct + "%" }} />
            </div>

            <ul className="sim-holdings">
              {sim.holdings.length === 0 ? (
                <li className="sim-holdings-empty">Add a ticker, then set how much capital it gets. Leftover stays cash.</li>
              ) : (
                sim.holdings.map((row) => (
                  <HoldingRow
                    key={row.ticker}
                    row={row}
                    max={sim.capital - (invested - row.amount)}
                    capital={sim.capital}
                    error={errors[row.ticker]}
                    onAmount={(amount) => updateAmount(row.ticker, amount)}
                    onRemove={() => removeHolding(row.ticker)}
                  />
                ))
              )}
              <li className="sim-holding sim-holding-cash" aria-label="Cash allocation">
                <span className="sim-holding-ticker">Cash</span>
                <span className="sim-holding-slider-spacer" aria-hidden="true" />
                <span className="sim-holding-cash-amt mono">${fmt(cash, 0)}</span>
                <span className="sim-holding-pct mono">{fmt(cashPct, 0)}%</span>
                <span className="sim-holding-spacer" aria-hidden="true" />
              </li>
            </ul>
          </div>
        </section>

        <aside className="sim-side" aria-label="Portfolio results">
          <div className="sim-metrics">
            <div className="sim-metric">
              <span className="k">Portfolio</span>
              <strong className={"mono " + valueTone}>${fmt(endPortfolio, 2)}</strong>
            </div>
            <div className="sim-metric">
              <span className="k">Difference</span>
              <strong className={"mono " + diffTone}>
                {diffPortfolio >= 0 ? "+" : "−"}${fmt(Math.abs(diffPortfolio), 2)}
              </strong>
            </div>
            <div className="sim-metric">
              <span className="k">Per $100</span>
              <strong className={"mono " + valueTone}>${fmt(endPer100, 2)}</strong>
            </div>
            <div className="sim-metric">
              <span className="k">CAGR</span>
              <strong className={"mono " + cagrTone}>
                {path ? (cagr >= 0 ? "+" : "") + fmt(cagr * 100, 2) + "%" : "—"}
              </strong>
            </div>
          </div>

          <label className="sim-benchmark">
            <input
              type="checkbox"
              checked={sim.showSpy}
              onChange={(e) => onSim({ ...sim, showSpy: e.target.checked })}
            />
            <span>Benchmark vs SPY</span>
          </label>
          <p className="sim-side-note">
            {sim.showSpy ? "SPY overlay coming soon. " : ""}
            Historical closes · cash earns 0% · not advice
          </p>
        </aside>
      </div>
    </article>
  );
}

function HoldingRow({
  row,
  max,
  capital,
  error,
  onAmount,
  onRemove,
}: {
  row: SimHolding;
  max: number;
  capital: number;
  error?: string;
  onAmount: (amount: number) => void;
  onRemove: () => void;
}) {
  const amount = Number.isFinite(row.amount) ? row.amount : 0;
  const pct = capital > 0 ? (amount / capital) * 100 : 0;
  return (
    <li className="sim-holding">
      <span className="sim-holding-ticker mono">{row.ticker}</span>
      <input
        className="sim-holding-slider"
        type="range"
        min={0}
        max={Math.max(0, max)}
        step={50}
        value={Math.min(amount, Math.max(0, max))}
        onChange={(e) => onAmount(parseFloat(e.target.value) || 0)}
        aria-label={row.ticker + " capital slider"}
      />
      <div className="sim-amount-input">
        <span>$</span>
        <input
          type="number"
          min={0}
          max={max}
          step={50}
          value={amount}
          onChange={(e) => {
            const next = e.target.value === "" ? 0 : parseFloat(e.target.value);
            onAmount(Number.isFinite(next) ? next : 0);
          }}
          aria-label={row.ticker + " capital"}
        />
      </div>
      <span className="sim-holding-pct mono">{fmt(pct, 0)}%</span>
      <button type="button" className="sim-remove" onClick={onRemove} aria-label={"Remove " + row.ticker}>
        ×
      </button>
      {error ? <div className="sim-error sim-holding-error" role="alert">{error}</div> : null}
    </li>
  );
}
