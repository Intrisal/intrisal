"use client";

import { useState, type ReactNode } from "react";
import { AnimatedPrice } from "@/components/AnimatedPrice";
import { BrandLogo } from "@/components/BrandLogo";
import { Fundamentals } from "@/components/Fundamentals";
import { RemoveIcon } from "@/components/Icons";
import { ValuationHistory } from "@/components/ValuationHistory";
import type { CompanySnapshot } from "@/lib/companyData";
import { trailingGrowth } from "@/lib/fiscalQuarter";
import { SimulationPanels } from "@/components/Simulation";
import { fmt, nameOf } from "@/lib/market";
import type { SimState } from "@/lib/portfolioSim";
import { stockSignalClass } from "@/lib/stockSignal";
import { useCompanySnapshot, useCompanySnapshots } from "@/lib/useCompanyData";
import { useQuotes } from "@/lib/useMarketData";

export type Section = "home" | "fundamental" | "learn" | "simulation" | "valuation" | "watchlist";

function Chg({ c }: { c: number }) {
  const up = c >= 0;
  return (
    <span className={up ? "chg-up" : "chg-dn"}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {fmt(c, 2)}%
    </span>
  );
}

function PanelHead({ title, sub }: { title: string; sub?: string }) {
  return <div className="panel-head"><h2>{title}</h2><span className="sub">{sub || ""}</span></div>;
}

function FootNote({ children }: { children: string }) {
  return <div className="foot">{children}</div>;
}

function metric(value: number | null | undefined, decimals: number, suffix = "", prefix = "") {
  return value == null ? "Data unavailable" : prefix + fmt(value, decimals) + suffix;
}

export function LineChart({ data, w, h, pad, label }: { data: number[]; w: number; h: number; pad: number; label: string }) {
  const min0 = Math.min.apply(null, data);
  const max0 = Math.max.apply(null, data);
  let span = max0 - min0 || 1;
  const min = min0 - span * 0.08;
  const max = max0 + span * 0.08;
  span = max - min;
  const pts = data.map(function (v, i) {
    const x = pad + (w - pad * 2) * (i / (data.length - 1));
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const d = pts
    .map(function (p, i) {
      return (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1);
    })
    .join(" ");
  const area = d + " L" + pts[pts.length - 1][0].toFixed(1) + " " + (h - pad) + " L" + pts[0][0].toFixed(1) + " " + (h - pad) + " Z";
  const grid = [];
  for (let g = 1; g <= 3; g++) {
    const gy = pad + ((h - pad * 2) * g) / 4;
    grid.push(<line key={g} x1={pad} y1={gy} x2={w - pad} y2={gy} stroke="var(--line)" strokeWidth="1" />);
  }
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={"0 0 " + w + " " + h} role="img" aria-label={label}>
      {grid}
      <path d={area} fill="var(--ink)" opacity="0.07" />
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--ink)" />
    </svg>
  );
}

const watchMetrics = { revenue: "Revenue growth", eps: "EPS growth", value: "EV/NOPAT" } as const;
type WatchMetric = keyof typeof watchMetrics;

function WatchPanel({
  watchlist,
  selected,
  onSelect,
  onRemove,
}: {
  watchlist: string[];
  selected: string;
  onSelect: (tk: string) => void;
  onRemove: (tk: string) => void;
}) {
  const { quotes, names } = useQuotes(watchlist);
  const { snapshots, loading } = useCompanySnapshots(watchlist, true);
  const [editing, setEditing] = useState(false);
  const [sort, setSort] = useState<{ key: WatchMetric; descending: boolean }>({ key: "value", descending: false });
  const rows = watchlist.map(tk => {
    const snap = snapshots[tk.toUpperCase()];
    const daily = snap?.latestDailyValuation;
    const current = daily?.multiple;
    const avg = snap?.evNopatAvg;
    const value = !snap?.isFund && !snap?.valuationHidden && !snap?.valuationHasNegativeOperatingIncome &&
      snap?.valuationAverageYears && current != null && current > 0 && avg != null && avg > 0 ? (current / avg - 1) * 100 : null;
    return { tk, snap, daily, value, revenue: snap && !snap.isFund ? trailingGrowth(snap.revenueHistory, snap.filingDates?.revenue) : null,
      eps: snap && !snap.isFund ? trailingGrowth(snap.epsHistory, snap.filingDates?.eps) : null };
  }).sort((left, right) => {
    const a = left[sort.key], b = right[sort.key];
    if (a === b) return left.tk.localeCompare(right.tk);
    if (a == null) return 1;
    if (b == null) return -1;
    return sort.descending ? b - a : a - b;
  });

  return (
    <article className={"panel watch-panel" + (!rows.length ? " is-empty" : "")}>
      {!rows.length ? <>
        <PanelHead title="Watchlist" />
        <div className="watch-empty"><p>Search to add stocks to your watchlist.</p></div>
      </> :
        <div className="watch-table-wrap">
          <table className={editing ? "watch-table is-editing" : "watch-table"} aria-label="Watchlist comparison">
            <thead><tr>
              <th colSpan={2} aria-label="Company" className="watch-company-heading">
                <span className="watch-table-title">Watchlist</span>
                <button type="button" className="watch-table-edit" onClick={() => setEditing(!editing)}>
                  {editing ? "Done" : "Edit"}
                </button>
              </th>
              <th scope="col">
                <span className="watch-price-heading">Price</span>
                <small>last close</small>
              </th>
              <th scope="col"><span className="watch-price-heading">Signal</span></th>
              {(Object.keys(watchMetrics) as WatchMetric[]).map(key =>
                <th scope="col" key={key} aria-sort={key !== sort.key ? "none" : sort.descending ? "descending" : "ascending"}>
                  <button type="button" onClick={() => setSort(prev => ({ key, descending: prev.key === key ? !prev.descending : key !== "value" }))}>
                    {watchMetrics[key]} <span aria-hidden="true">{key !== sort.key ? "↕" : sort.descending ? "↓" : "↑"}</span>
                  </button><small>{key === "value" ? "daily vs. quarterly avg" : "TTM year over year"}</small>
                </th>)}
            </tr></thead>
            <tbody>{rows.map(({ tk, snap, daily, value, revenue, eps }) => {
              const quote = quotes[tk]?.source === "marketstack" ? quotes[tk] : null;
              const name = names[tk] ?? snap?.name ?? nameOf(tk);
              const missing = loading && !snap ? "…" : "—";
              return <tr key={tk}>
                <td className="watch-remove-cell" aria-hidden={!editing}>
                  <div className="watch-remove-slot">
                    <button className="watch-row-remove" type="button" disabled={!editing} aria-label={"Remove " + tk + " from watchlist"} onClick={() => {
                      if (rows.length === 1) setEditing(false);
                      onRemove(tk);
                    }}><RemoveIcon /></button>
                  </div>
                </td>
                <th scope="row"><button className="watch-company" type="button" onClick={() => onSelect(tk)} aria-label={"Open " + name + " — " + tk} aria-current={selected === tk || undefined}>
                  <span className="watch-card-logo" aria-hidden="true"><BrandLogo tk={tk} /></span>
                  <span><strong>{tk}</strong><small>{name}</small></span>
                </button></th>
                <td title={quote ? "Close as of " + quote.date : undefined}>{quote ? <><AnimatedPrice price={quote.price} /><small><Chg c={quote.change} /></small></> : "—"}</td>
                <td className={stockSignalClass(snap?.signal)}>{snap?.signal ?? missing}</td>
                {[revenue, eps].map((growth, i) => <td key={i} className={growth == null || growth === 0 ? "" : growth > 0 ? "chg-up" : "chg-dn"}>
                  {growth == null ? missing : (growth > 0 ? "+" : "") + fmt(growth, 1) + "%"}
                </td>)}
                <td title={daily ? "Daily EV/NOPAT as of " + daily.date : undefined}>{value != null && snap && daily ? <>
                  <strong className={value < 0 ? "chg-up" : value > 0 ? "chg-dn" : ""}>{fmt(Math.abs(value), 1)}% {value < 0 ? "under" : value > 0 ? "over" : "at avg"}</strong>
                  <small>{fmt(daily.multiple, 1)}× vs {fmt(snap.evNopatAvg!, 1)}× · {snap.valuationAverageYears}Y</small>
                </> : missing}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
    </article>
  );
}

function ValuationPanel({ watchlist, selected, onSelect }: { watchlist: string[]; selected: string; onSelect: (tk: string) => void }) {
  const { snapshots, loading } = useCompanySnapshots(watchlist);
  const row = (tk: string) => {
    const snap = snapshots[tk.toUpperCase()];
    return {
      pe: snap?.peTtm ?? null,
      evn: snap?.evNopat ?? null,
      avg: snap?.evNopatAvg ?? null,
    };
  };
  const sorted = watchlist.slice().sort(function (a, b) {
    const left = row(a).evn;
    const right = row(b).evn;
    return left == null ? (right == null ? 0 : 1) : right == null ? -1 : left - right;
  });
  return (
    <article className="panel">
      <PanelHead title="Valuation" sub="sorted by EV/NOPAT" />
      <table className="mini">
        <thead>
          <tr>
            <th>Ticker</th>
            <th className="num">P/E (TTM)</th>
            <th className="num">EV/NOPAT</th>
            <th className="num">Avg</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(function (tk) {
            const s = row(tk);
            return (
              <tr key={tk} data-tk={tk} className={tk === selected ? "sel" : undefined} onClick={() => onSelect(tk)}>
                <td className="tk">{tk}</td><td className="num mono">{metric(s.pe, 1, "x")}</td><td className="num mono">{metric(s.evn, 1, "x")}</td><td className="num mono">{metric(s.avg, 1, "x")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading ? <FootNote>Loading…</FootNote> : null}
    </article>
  );
}

function BarRow({ label, val, max, suffix }: { label: string; val: number | null; max: number; suffix: string }) {
  const pct = val == null ? 0 : Math.max(4, Math.min(100, (val / max) * 100));
  return (
    <div className="bar-row">
      <span>{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: pct + "%" }} /></div><span className="mono" style={{ textAlign: "right" }}>{metric(val, 1, suffix)}</span>
    </div>
  );
}

function ValuationDetailPanel({ selected, watchlist, showStockName = true }: { selected: string; watchlist: string[]; showStockName?: boolean }) {
  const { snapshot } = useCompanySnapshot(selected);
  const { snapshots } = useCompanySnapshots(watchlist);
  const s = {
    fpe: snapshot?.peTtm ?? null,
    evn: snapshot?.evNopat ?? null,
    avg: snapshot?.evNopatAvg ?? null,
  };
  const evs = watchlist.flatMap((tk) => snapshots[tk.toUpperCase()]?.evNopat ?? []).sort((a, b) => a - b);
  const med = evs[Math.floor(evs.length / 2)] ?? null;
  const verdict = s.evn == null || med == null ? ""
    : s.evn === med ? "Trading at the watchlist median EV/NOPAT."
    : s.evn < med ? "Trading below the watchlist median EV/NOPAT." : "Trading above the watchlist median EV/NOPAT.";
  return (
    <article className="panel">
      <PanelHead title={showStockName ? "Valuation — " + selected : "Valuation"} sub={showStockName ? (snapshot?.name ?? nameOf(selected)) : undefined} />
      <BarRow label="P/E (TTM)" val={s.fpe} max={50} suffix="x" />
      <BarRow label="EV/NOPAT" val={s.evn} max={55} suffix="x" />
      <BarRow label={(snapshot?.valuationAverageYears ?? 10) + "Y average"} val={s.avg} max={55} suffix="x" />
      <BarRow label="Median" val={med} max={55} suffix="x" />
      <p style={{ fontSize: "14.5px", lineHeight: 1.6, color: "var(--ink-2)", margin: "14px 0 0" }}>
        {verdict} EV/NOPAT is enterprise value divided by after-tax operating income — the v2 headline multiple.
      </p>
    </article>
  );
}

function FundamentalPanel({ selected }: { selected: string }) {
  const { snapshot, loading } = useCompanySnapshot(selected);
  const vals = snapshot?.revenueHistory.slice(-5) ?? [];
  const growth = snapshot?.growthYoY;
  const max = Math.max(1, ...vals);
  const bw = 64;
  const gap = 26;
  const base = 168;
  const top = 16;
  return (
    <article className="panel">
      <PanelHead title={"Revenue — " + selected} sub="trailing twelve months, $B" />
      {vals.length ? <svg viewBox="0 0 480 200" role="img" aria-label="Revenue by period chart" style={{ width: "100%", height: "auto", display: "block" }}>
        {vals.map(function (val, i) {
          const h = (val / max) * (base - top);
          const x = 20 + i * (bw + gap);
          return (
            <g key={i}>
              <rect x={x} y={base - h} width={bw} height={h} rx="5" fill="var(--ink)" opacity={i === vals.length - 1 ? "1" : "0.35"} />
              <text x={x + bw / 2} y={base + 22} textAnchor="middle" fontSize="12" fill="var(--ink-3)">
                {i === vals.length - 1 ? "TTM" : `${vals.length - 1 - i}q`}
              </text>
              <text x={x + bw / 2} y={base - h - 8} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">
                ${fmt(val, 0)}B
              </text>
            </g>
          );
        })}
      </svg> : <FootNote>{loading ? "Loading…" : "Data unavailable"}</FootNote>}
      <p style={{ fontSize: "14px", color: "var(--ink-2)", margin: "10px 0 0" }}>
        TTM revenue growth <strong style={{ color: "var(--ink)" }}>{metric(growth, 1, "%", growth != null && growth >= 0 ? "+" : "")}</strong> year over year.
      </p>
    </article>
  );
}

function Stat({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v mono">{v}</div>
      <div className="d">{d}</div>
    </div>
  );
}

function StatsPanel({ selected }: { selected: string }) {
  const { snapshot } = useCompanySnapshot(selected);
  const rev = snapshot?.revBillions;
  const growth = snapshot?.growthYoY;
  const eps = snapshot?.epsTtm;
  const fcf = snapshot?.fcfBillions;
  const opinc = snapshot?.opincBillions;
  const pe = snapshot?.peTtm;
  const de = snapshot?.de;
  return (
    <article className="panel">
      <PanelHead title={"Fundamentals — " + selected} sub="TTM" />
      <div className="stat-grid">{[
        <Stat key="rev" k="Revenue" v={metric(rev, 1, "B", "$")} d={growth == null ? "" : metric(growth, 1, "% YoY", growth >= 0 ? "+" : "")} />,
        <Stat key="eps" k="EPS" v={metric(eps, 2, "", "$")} d="diluted, TTM" />,
        <Stat key="fcf" k="Free cash flow" v={metric(fcf, 1, "B", "$")} d={fcf != null && rev && rev > 0 ? metric(fcf / rev * 100, 0, "% of revenue") : ""} />,
        <Stat key="op" k="Operating income" v={metric(opinc, 1, "B", "$")} d={opinc != null && rev && rev > 0 ? metric(opinc / rev * 100, 0, "% margin") : ""} />,
      ]}</div>
      <div className="stat-grid" style={{ marginTop: 12 }}>{[
        <Stat key="pe" k="P/E (TTM)" v={metric(pe, 1, "x")} d="price ÷ TTM diluted EPS" />,
        <Stat key="de" k="Debt / Equity" v={de ?? "Data unavailable"} d="from filings" />,
      ]}</div>
    </article>
  );
}

function LearnPanels() {
  return [
    <article key="multiple" className="panel learn">
        <PanelHead title="Learn" sub="the headline multiple" />
        <div className="formula mono">EV/NOPAT = Enterprise Value ÷ (Operating Income × (1 − tax rate))</div>
        <p>
          <strong>Why not trailing P/E?</strong> One-off equity gains and losses can swing a company&apos;s reported earnings without changing the business underneath. Operating income comes straight from the core business, so the multiple tracks the business, not the noise.
        </p>
        <p>
          <strong>How it&apos;s used here:</strong> each stock&apos;s EV/NOPAT is compared with its own ten-year average using the available quarterly data. A multiple well below its history can mean room for multiple expansion; one far above it leaves no cushion if growth disappoints.
        </p>
        <div className="foot">From the v2 method notes.</div>
      </article>,
    <article key="risk" className="panel learn">
        <PanelHead title="Learn" sub="valuation risk" />
        <p>
          <strong>Multiple compression</strong> is what happens when a stock priced for perfection meets merely good news. At a very high multiple, the price already assumes years of flawless growth — anything less and the multiple shrinks, pulling the price down even when the business is fine.
        </p>
        <p>
          <strong>Forward P/E</strong> prices the stock against next year&apos;s expected earnings instead of last year&apos;s. Paired with EV/NOPAT, it shows both what the market expects and what the business has actually delivered.
        </p>
        <p>
          <strong>The 50/200-day lines</strong> on the chart view show trend: price above both moving averages is an uptrend; a 50-day crossing the 200-day either way is the classic golden/death cross signal.
        </p>
        <div className="foot">Educational only — not financial advice.</div>
      </article>,
  ];
}

export function StockAnalysis({ mode, selected, snapshot, loading, showUsd }: {
  mode: "fundamental" | "valuation";
  selected: string;
  snapshot: CompanySnapshot | null;
  loading: boolean;
  showUsd?: boolean;
}) {
  return (
    <section className="panels stock-analysis-panels" data-analysis={mode} aria-label={mode === "fundamental" ? "Stock fundamentals" : "Stock valuation"}>
      {mode === "fundamental" ? (
        <Fundamentals ticker={selected} snapshot={snapshot} loading={loading} showUsd={showUsd} />
      ) : (
        <>
          <ValuationHistory ticker={selected} snapshot={snapshot} loading={loading} />
          {(selected === "AMZN" || selected === "GOOG") && (
            <ValuationHistory ticker={selected} snapshot={snapshot} loading={loading} adjustedPe />
          )}
        </>
      )}
    </section>
  );
}

export function Panels({
  section,
  selected,
  watchlist,
  onSelect,
  onRemove,
  sim,
  onSim,
}: {
  section: Section;
  selected: string;
  watchlist: string[];
  onSelect: (tk: string) => void;
  onRemove: (tk: string) => void;
  sim: SimState;
  onSim: (next: SimState) => void;
}) {
  let body: ReactNode = null;
  if (section === "watchlist") {
    body = (
      <WatchPanel
        key="watch"
        watchlist={watchlist}
        selected={selected}
        onSelect={onSelect}
        onRemove={onRemove}
      />
    );
  } else if (section === "valuation") {
    body = [
      <ValuationPanel key="valuation" watchlist={watchlist} selected={selected} onSelect={onSelect} />,
      <ValuationDetailPanel key="detail" selected={selected} watchlist={watchlist} />,
    ];
  } else if (section === "fundamental") {
    body = [<FundamentalPanel key="revenue" selected={selected} />, <StatsPanel key="stats" selected={selected} />];
  } else if (section === "simulation") {
    body = <SimulationPanels key="simulation" sim={sim} onSim={onSim} watchlist={watchlist} />;
  } else if (section === "learn") {
    body = <LearnPanels />;
  }
  return (
    <section
      className={"panels" + (section === "simulation" ? " sim-panels" : "")}
      id="panels"
      aria-live="polite"
    >
      {body}
    </section>
  );
}
