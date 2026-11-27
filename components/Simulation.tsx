"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { ChartReveal } from "@/components/ChartReveal";
import {
  SIM_RANGES,
  allocatedAmount,
  buildPortfolioPath,
  cashAmount,
  evenCapitalAmounts,
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
const CLOSE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

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
  revealKey,
}: {
  values: number[];
  dates: string[];
  range: SimRange;
  capital: number;
  spyValues?: number[] | null;
  showSpy: boolean;
  revealKey: string;
}) {
  const w = 720;
  const h = 320;
  const padL = 58;
  const padR = 18;
  const padT = 16;
  const padB = 36;
  const plotLeft = padL;
  const plotRight = w - padR;
  const plotTop = padT;
  const plotBottom = h - padB;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const prevRevealKey = useRef(revealKey);
  const previousKey = prevRevealKey.current;
  const quickReveal = previousKey !== revealKey
    && previousKey.split("|").slice(1).join("|") === revealKey.split("|").slice(1).join("|");

  useEffect(() => {
    prevRevealKey.current = revealKey;
    setHoverIndex(null);
  }, [revealKey]);

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
  const min = min0 - span * 0.08;
  const max = max0 + span * 0.1;
  span = max - min;
  const yTicks = niceAxisTicks(min, max, 5);
  const xIndexes = dateTickIndexes(dates.length, range === "1Y" || range === "2Y" ? 5 : 6);

  function xAt(index: number) {
    return plotLeft + ((plotRight - plotLeft) * index) / (dollarValues.length - 1);
  }
  function yAt(value: number) {
    return plotTop + (plotBottom - plotTop) * (1 - (value - min) / span);
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

  function indexFromClientX(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * w;
    if (x < plotLeft || x > plotRight) return null;
    const ratio = (x - plotLeft) / (plotRight - plotLeft);
    return Math.max(0, Math.min(dollarValues.length - 1, Math.round(ratio * (dollarValues.length - 1))));
  }

  function onPointerMove(ev: ReactPointerEvent<SVGSVGElement>) {
    const index = indexFromClientX(ev.clientX);
    if (index !== null) setHoverIndex(index);
  }

  const d = pathFor(dollarValues);
  const lastX = xAt(dollarValues.length - 1);
  const lastY = yAt(dollarValues.at(-1)!);
  const baseY = yAt(capital);
  const area = d + " L" + lastX.toFixed(1) + " " + plotBottom + " L" + plotLeft.toFixed(1) + " " + plotBottom + " Z";
  const scrub = hoverIndex !== null ? {
    index: hoverIndex,
    x: xAt(hoverIndex),
    y: yAt(dollarValues[hoverIndex]!),
    value: dollarValues[hoverIndex]!,
    date: dates[hoverIndex]!,
  } : null;
  const tipLeft = scrub ? (scrub.x / w) * 100 + "%" : "0%";

  return (
    <div className={"stock-chart-wrap sim-chart-wrap" + (scrub ? " is-scrubbing" : "")}>
      <svg
        ref={svgRef}
        className="sim-chart-svg"
        viewBox={"0 0 " + w + " " + h}
        role="img"
        aria-label="Portfolio value over time. Hover or drag to read a value."
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {yTicks.map((tick) => {
          const y = yAt(tick);
          return (
            <g key={"y-" + tick}>
              <line x1={plotLeft} x2={plotRight} y1={y} y2={y} className="sim-chart-grid" />
              <text x={plotLeft - 10} y={y + 3.5} textAnchor="end" className="sim-chart-label">
                {formatAxisMoney(tick)}
              </text>
            </g>
          );
        })}
        {xIndexes.map((index) => {
          const x = xAt(index);
          return (
            <text key={"x-" + index} x={x} y={h - 12} textAnchor="middle" className="sim-chart-label">
              {formatAxisDate(dates[index]!, range)}
            </text>
          );
        })}
        <line x1={plotLeft} x2={plotRight} y1={baseY} y2={baseY} className="sim-chart-base" />
        <ChartReveal
          key={revealKey}
          left={plotLeft}
          right={plotRight}
          top={plotTop}
          bottom={plotBottom}
          quick={quickReveal}
        >
          <path d={area} className="sim-chart-fill" />
          <path
            d={d}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {showSpy && spyDollars && spyDollars.length === dollarValues.length ? (
            <path
              d={pathFor(spyDollars)}
              fill="none"
              stroke="var(--ink-3)"
              strokeWidth="1.8"
              strokeDasharray="5 4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          <circle cx={lastX} cy={lastY} r="4" fill="var(--ink)" />
        </ChartReveal>
        <rect
          className="stock-chart-hit"
          x={plotLeft}
          y={plotTop}
          width={plotRight - plotLeft}
          height={plotBottom - plotTop}
          fill="transparent"
        />
        {scrub ? (
          <g className="stock-chart-scrub" aria-hidden="true">
            <line className="stock-chart-crosshair" x1={scrub.x} x2={scrub.x} y1={plotTop} y2={plotBottom} />
            <circle className="stock-chart-dot sim-chart-dot" cx={scrub.x} cy={scrub.y} r="5.5" />
          </g>
        ) : null}
      </svg>
      {scrub ? (
        <div
          className={"stock-chart-tip" + (scrub.x > (plotLeft + plotRight) / 2 ? " is-left" : "")}
          style={{ left: tipLeft }}
        >
          <strong>${fmt(scrub.value, 2)}</strong>
          <span>{CLOSE_DATE_FORMAT.format(new Date(scrub.date + "T00:00:00Z"))}</span>
        </div>
      ) : null}
    </div>
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

function parseCapitalInput(raw: string) {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return 0;
  return clampCapital(parseFloat(cleaned));
}

/** Keep commas while typing; preserve a trailing decimal while editing. */
function formatCapitalInput(raw: string) {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const negativeBlocked = cleaned.replace(/-/g, "");
  const firstDot = negativeBlocked.indexOf(".");
  const wholeRaw = firstDot === -1 ? negativeBlocked : negativeBlocked.slice(0, firstDot);
  const fraction = firstDot === -1 ? null : negativeBlocked.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || (fraction != null ? "0" : "");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fraction != null) return withCommas + "." + fraction;
  if (negativeBlocked.endsWith(".")) return withCommas + ".";
  return withCommas;
}

function formatCapitalValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

export function SimulationPanels({
  sim,
  onSim,
  watchlist,
}: {
  sim: SimState;
  onSim: (next: SimState) => void;
  watchlist: string[];
}) {
  const [draftTicker, setDraftTicker] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addNote, setAddNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importingWatchlist, setImportingWatchlist] = useState(false);
  const [watchlistAdded, setWatchlistAdded] = useState(false);
  const [capitalDraft, setCapitalDraft] = useState(formatCapitalValue(sim.capital));

  useEffect(() => {
    setCapitalDraft(formatCapitalValue(sim.capital));
  }, [sim.capital]);

  useEffect(() => {
    setWatchlistAdded(false);
  }, [watchlist]);

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
  const watchlistTickers = useMemo(
    () => [...new Set(watchlist.map(normalizeTicker).filter(Boolean))],
    [watchlist],
  );

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
      setWatchlistAdded(false);
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
    setWatchlistAdded(false);
    onSim({
      ...sim,
      holdings: sim.holdings.map((row) => (row.ticker === ticker ? { ...row, amount } : row)),
    });
  }

  function removeHolding(ticker: string) {
    setWatchlistAdded(false);
    onSim({ ...sim, holdings: sim.holdings.filter((row) => row.ticker !== ticker) });
  }

  function removeAllHoldings() {
    if (!sim.holdings.length) return;
    setWatchlistAdded(false);
    setAddError(null);
    setAddNote(null);
    onSim({ ...sim, holdings: [] });
  }

  async function addWatchlist() {
    setAddError(null);
    setAddNote(null);
    if (!watchlistTickers.length) {
      setAddError("Your watchlist is empty.");
      return;
    }
    if (!(sim.capital > 0)) {
      setAddError("Set starting capital first.");
      return;
    }
    setImportingWatchlist(true);
    try {
      const results = await Promise.all(
        watchlistTickers.map(async (ticker) => {
          try {
            const res = await fetch("/api/market/history?symbol=" + encodeURIComponent(ticker), { cache: "no-store" });
            const body = await res.json();
            if (!res.ok) return { ticker, ok: false as const };
            const cleaned = sanitizeSeries(body as StockHistory);
            return { ticker, ok: hasTenYearPriceHistory(cleaned.dates) };
          } catch {
            return { ticker, ok: false as const };
          }
        }),
      );
      const eligible = results.filter((row) => row.ok).map((row) => row.ticker);
      const skipped = results.length - eligible.length;
      if (!eligible.length) {
        setAddError("No watchlist tickers have ~10Y stored prices yet.");
        setWatchlistAdded(false);
        return;
      }
      const amounts = evenCapitalAmounts(sim.capital, eligible.length);
      const holdings: SimHolding[] = eligible.map((ticker, i) => ({
        ticker,
        amount: amounts[i] ?? 0,
      }));
      onSim({ ...sim, holdings });
      setWatchlistAdded(true);
      if (skipped > 0) {
        setAddNote(
          "Added " + eligible.length + " evenly. Skipped " + skipped + " without enough price history.",
        );
      }
    } finally {
      setImportingWatchlist(false);
    }
  }

  function commitCapital(raw: string) {
    const nextCapital = parseCapitalInput(raw);
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
    setWatchlistAdded(false);
    onSim({ ...sim, capital: nextCapital, holdings: adjusted });
    setCapitalDraft(formatCapitalValue(nextCapital));
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
  const chartRevealKey = [
    sim.range,
    String(sim.capital),
    sim.holdings.map((row) => row.ticker + ":" + row.amount).join(","),
  ].join("|");

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
                revealKey={chartRevealKey}
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
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    value={capitalDraft}
                    onChange={(e) => setCapitalDraft(formatCapitalInput(e.target.value))}
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
                    setAddNote(null);
                    setWatchlistAdded(false);
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

            <div className="sim-holdings-head">
              <span className="sim-holdings-label">Holdings</span>
              <button
                type="button"
                className="sim-remove-all"
                disabled={sim.holdings.length === 0}
                onClick={removeAllHoldings}
              >
                Remove all
              </button>
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
                <span className="sim-holding-identity">
                  <span className="sim-holding-logo sim-holding-logo-cash" aria-hidden="true">$</span>
                  <span className="sim-holding-ticker">Cash</span>
                </span>
                <span className="sim-holding-slider-spacer" aria-hidden="true" />
                <span className="sim-holding-cash-pct mono">{fmt(cashPct, 1)}%</span>
                <span className="sim-holding-capital mono">${fmt(cash, 0)}</span>
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

          <button
            type="button"
            className="stock-watchlist-button sim-watchlist-button"
            data-added={watchlistAdded}
            disabled={importingWatchlist || watchlistTickers.length === 0 || !(sim.capital > 0)}
            aria-label={watchlistAdded ? "Watchlist added to simulation" : "Add watchlist to simulation"}
            onClick={() => void addWatchlist()}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path className="stock-watchlist-plus" d="M10 5v10M5 10h10" />
              <path className="stock-watchlist-check" pathLength={1} d="m5 10 3.2 3.2L15 6.6" />
            </svg>
            <span>
              {importingWatchlist
                ? "Adding…"
                : watchlistAdded
                  ? "Watchlist Added"
                  : "Add Watchlist"}
            </span>
          </button>
          {addNote ? <div className="sim-note">{addNote}</div> : null}

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
  // Room left for this row = its current % + unallocated cash %.
  const maxPct = capital > 0 ? (Math.max(0, max) / capital) * 100 : 0;
  const shownPct = Math.round(Math.min(Math.max(pct, 0), 100) * 10) / 10;

  function setPercent(nextPct: number) {
    if (!(capital > 0)) {
      onAmount(0);
      return;
    }
    const clamped = Math.max(0, Math.min(maxPct, Number.isFinite(nextPct) ? nextPct : 0));
    onAmount(clampAmount((clamped / 100) * capital, max));
  }

  return (
    <li className="sim-holding">
      <span className="sim-holding-identity">
        <span className="sim-holding-logo" aria-hidden="true">
          <BrandLogo tk={row.ticker} />
        </span>
        <span className="sim-holding-ticker mono">{row.ticker}</span>
      </span>
      <div className="sim-holding-slider-wrap">
        <input
          className="sim-holding-slider"
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={Math.min(shownPct, 100)}
          onChange={(e) => setPercent(parseFloat(e.target.value) || 0)}
          aria-valuemin={0}
          aria-valuemax={Math.round(maxPct * 10) / 10}
          aria-label={row.ticker + " allocation percent"}
        />
        <span
          className="sim-holding-slider-limit"
          style={{ width: Math.max(0, 100 - maxPct) + "%" }}
          title="Already allocated elsewhere"
          aria-hidden="true"
        />
      </div>
      <div className="sim-amount-input sim-pct-input">
        <input
          type="number"
          min={0}
          max={Math.round(maxPct * 10) / 10}
          step={0.5}
          value={shownPct}
          onChange={(e) => {
            const next = e.target.value === "" ? 0 : parseFloat(e.target.value);
            setPercent(Number.isFinite(next) ? next : 0);
          }}
          aria-label={row.ticker + " allocation percent"}
        />
        <span>%</span>
      </div>
      <span className="sim-holding-capital mono">${fmt(amount, 0)}</span>
      <button type="button" className="sim-remove" onClick={onRemove} aria-label={"Remove " + row.ticker}>
        ×
      </button>
      {error ? <div className="sim-error sim-holding-error" role="alert">{error}</div> : null}
    </li>
  );
}
