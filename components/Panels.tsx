"use client";

import type { ReactNode } from "react";
import { AnimatedPrice } from "@/components/AnimatedPrice";
import { BrandLogo } from "@/components/BrandLogo";
import { Fundamentals } from "@/components/Fundamentals";
import { RemoveIcon } from "@/components/Icons";
import { ValuationHistory } from "@/components/ValuationHistory";
import type { CompanySnapshot } from "@/lib/companyData";
import { fmt, hashStr, nameOf, projectSim, rng, sample, type SimInput } from "@/lib/market";
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
  const { quotes } = useQuotes(watchlist);
  const countLabel = watchlist.length === 0
    ? "Empty"
    : watchlist.length === 1
      ? "1 stock"
      : watchlist.length + " stocks";

  return (
    <article className={"panel watch-panel" + (watchlist.length === 0 ? " is-empty" : "")}>
      <PanelHead title="Watchlist" sub={countLabel} />
      {watchlist.length === 0 ? (
        <div className="watch-empty">
          <p>Search to add stocks to your watchlist.</p>
        </div>
      ) : (
        <div className="watch-gallery" role="list" aria-label="Your watchlist">
          {watchlist.map(function (tk) {
            const live = quotes[tk];
            const quote = live?.source === "marketstack" ? live : null;
            const up = (quote?.change ?? 0) >= 0;
            return (
              <div key={tk} role="listitem" className={"watch-card" + (tk === selected ? " sel" : "")}>
                <button type="button" className="watch-card-main" onClick={() => onSelect(tk)} aria-label={"Open " + tk + " — " + nameOf(tk)}>
                  <span className="watch-card-logo" aria-hidden="true"><BrandLogo tk={tk} /></span>
                  <span className="watch-card-meta">
                    <strong>{tk}</strong>
                    <span>{nameOf(tk)}</span>
                  </span>
                  <span className="watch-card-quote mono">
                    <span className="watch-card-price" title={quote ? "Close as of " + quote.date : undefined}>
                      {quote ? <AnimatedPrice price={quote.price} /> : "—"}
                    </span>
                    <span className={quote ? (up ? "chg-up" : "chg-dn") : "watch-card-chg-empty"}>
                      {quote ? ((up ? "▲ +" : "▼ ") + fmt(quote.change, 2) + "%") : "—"}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="watch-card-remove"
                  aria-label={"Remove " + tk + " from watchlist"}
                  onClick={() => onRemove(tk)}
                >
                  <RemoveIcon />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function ValuationPanel({ watchlist, selected, onSelect }: { watchlist: string[]; selected: string; onSelect: (tk: string) => void }) {
  const { snapshots, loading } = useCompanySnapshots(watchlist);
  const row = (tk: string) => {
    const snap = snapshots[tk.toUpperCase()];
    const fallback = sample(tk);
    return {
      pe: snap?.peTtm ?? fallback.fpe,
      evn: snap?.evNopat ?? fallback.evn,
      avg: snap?.evNopatAvg ?? null,
      live: snap?.sources.fundamentals === "edgar",
    };
  };
  const sorted = watchlist.slice().sort(function (a, b) {
    return row(a).evn - row(b).evn;
  });
  const liveCount = sorted.filter((tk) => row(tk).live).length;
  return (
    <article className="panel">
      <PanelHead title="Valuation" sub="sorted by EV/NOPAT" />
      <table className="mini">
        <thead>
          <tr>
            <th>Ticker</th>
            <th className="num">P/E (TTM)</th>
            <th className="num">EV/NOPAT</th>
            <th className="num">10Y Avg</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(function (tk) {
            const s = row(tk);
            return (
              <tr key={tk} data-tk={tk} className={tk === selected ? "sel" : undefined} onClick={() => onSelect(tk)}>
                <td className="tk">{tk}</td><td className="num mono">{fmt(s.pe, 1)}x</td><td className="num mono">{fmt(s.evn, 1)}x</td><td className="num mono">{s.avg == null ? "—" : `${fmt(s.avg, 1)}x`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading ? <FootNote>Loading…</FootNote> : !liveCount ? <FootNote>Sample data for layout preview.</FootNote> : null}
    </article>
  );
}

function BarRow({ label, val, max, suffix }: { label: string; val: number | null; max: number; suffix: string }) {
  const pct = val == null ? 0 : Math.max(4, Math.min(100, (val / max) * 100));
  return (
    <div className="bar-row">
      <span>{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: pct + "%" }} /></div><span className="mono" style={{ textAlign: "right" }}>{val == null ? "—" : fmt(val, 1) + suffix}</span>
    </div>
  );
}

function ValuationDetailPanel({ selected, watchlist, showStockName = true }: { selected: string; watchlist: string[]; showStockName?: boolean }) {
  const { snapshot } = useCompanySnapshot(selected);
  const { snapshots } = useCompanySnapshots(watchlist);
  const fallback = sample(selected);
  const s = {
    fpe: snapshot?.peTtm ?? fallback.fpe,
    evn: snapshot?.evNopat ?? fallback.evn,
    avg: snapshot?.evNopatAvg ?? null,
  };
  const evs = watchlist.map(function (tk) {
    const snap = snapshots[tk.toUpperCase()];
    return snap?.evNopat ?? sample(tk).evn;
  });
  const med = evs.length
    ? evs.slice().sort(function (a, b) {
        return a - b;
      })[Math.floor(evs.length / 2)]
    : 0;
  const verdict = s.evn < med ? "Trading below the watchlist median EV/NOPAT." : "Trading above the watchlist median EV/NOPAT.";
  return (
    <article className="panel">
      <PanelHead title={showStockName ? "Valuation — " + selected : "Valuation"} sub={showStockName ? nameOf(selected) : undefined} />
      <BarRow label="P/E (TTM)" val={s.fpe} max={50} suffix="x" />
      <BarRow label="EV/NOPAT" val={s.evn} max={55} suffix="x" />
      <BarRow label="10Y average" val={s.avg} max={55} suffix="x" />
      <BarRow label="Median" val={med} max={55} suffix="x" />
      <p style={{ fontSize: "14.5px", lineHeight: 1.6, color: "var(--ink-2)", margin: "14px 0 0" }}>
        {verdict} EV/NOPAT is enterprise value divided by after-tax operating income — the v2 headline multiple.
      </p>
      {snapshot?.sources.fundamentals !== "edgar" ? <FootNote>Sample data for layout preview.</FootNote> : null}
    </article>
  );
}

function FundamentalPanel({ selected }: { selected: string }) {
  const { snapshot } = useCompanySnapshot(selected);
  const s = sample(selected);
  const hist = snapshot?.revenueHistory?.length ? snapshot.revenueHistory : null;
  const vals = hist
    ? hist.slice(-5)
    : (() => {
        const r = rng(hashStr(selected + ":rev"));
        const out: number[] = [];
        let v = s.rev / Math.pow(1 + s.growth / 100, 4);
        for (let i = 0; i < 5; i++) {
          out.push(v);
          v *= 1 + (s.growth + (r() - 0.5) * 6) / 100;
        }
        return out;
      })();
  const growth = snapshot?.growthYoY ?? s.growth;
  const max = Math.max.apply(null, vals);
  const bw = 64;
  const gap = 26;
  const base = 168;
  const top = 16;
  return (
    <article className="panel">
      <PanelHead title={"Revenue — " + selected} sub="trailing twelve months, $B" />
      <svg viewBox="0 0 480 200" role="img" aria-label="Revenue by period chart" style={{ width: "100%", height: "auto", display: "block" }}>
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
      </svg>
      <p style={{ fontSize: "14px", color: "var(--ink-2)", margin: "10px 0 0" }}>
        TTM revenue growth <strong style={{ color: "var(--ink)" }}>{growth >= 0 ? "+" : ""}{fmt(growth, 1)}%</strong> year over year.
      </p>
      {snapshot?.sources.fundamentals !== "edgar" ? <FootNote>Sample data for layout preview.</FootNote> : null}
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
  const fallback = sample(selected);
  const rev = snapshot?.revBillions ?? fallback.rev;
  const growth = snapshot?.growthYoY ?? fallback.growth;
  const eps = snapshot?.epsTtm ?? fallback.eps;
  const fcf = snapshot?.fcfBillions ?? fallback.fcf;
  const opinc = snapshot?.opincBillions ?? fallback.opinc;
  const pe = snapshot?.peTtm ?? fallback.fpe;
  const de = snapshot?.de ?? fallback.de;
  return (
    <article className="panel">
      <PanelHead title={"Fundamentals — " + selected} sub="TTM" />
      <div className="stat-grid">{[
        <Stat key="rev" k="Revenue" v={"$" + fmt(rev, 1) + "B"} d={(growth >= 0 ? "+" : "") + fmt(growth, 1) + "% YoY"} />,
        <Stat key="eps" k="EPS" v={"$" + fmt(eps, 2)} d="diluted, TTM" />,
        <Stat key="fcf" k="Free cash flow" v={"$" + fmt(fcf, 1) + "B"} d={fmt((fcf / Math.max(rev, 0.01)) * 100, 0) + "% of revenue"} />,
        <Stat key="op" k="Operating income" v={"$" + fmt(opinc, 1) + "B"} d={fmt((opinc / Math.max(rev, 0.01)) * 100, 0) + "% margin"} />,
      ]}</div>
      <div className="stat-grid" style={{ marginTop: 12 }}>{[
        <Stat key="pe" k="P/E (TTM)" v={fmt(pe, 1) + "x"} d="price ÷ TTM diluted EPS" />,
        <Stat key="de" k="Debt / Equity" v={de ?? "—"} d="from filings + market cap" />,
      ]}</div>
      {snapshot?.sources.fundamentals !== "edgar" ? <FootNote>Sample data for layout preview.</FootNote> : null}
    </article>
  );
}

function SimulationPanels({ sim, onSim }: { sim: SimInput; onSim: (next: SimInput) => void }) {
  const projection = projectSim(sim);
  return [
    <article key="controls" className="panel sim">
        <PanelHead title="Simulation" sub="compound growth" />
        <label htmlFor="simStart">Starting amount ($)</label>
        <input id="simStart" type="number" value={sim.start} min={0} step={500} onChange={(e) => onSim({ ...sim, start: e.target.value })} />
        <label htmlFor="simMonthly">Monthly contribution ($)</label>
        <input id="simMonthly" type="number" value={sim.monthly} min={0} step={25} onChange={(e) => onSim({ ...sim, monthly: e.target.value })} />
        <label htmlFor="simYears">
          Years: <span id="simYearsOut" className="mono">{sim.years}</span>
        </label>
        <input
          id="simYears"
          type="range"
          min={1}
          max={40}
          value={sim.years}
          onChange={(e) => onSim({ ...sim, years: parseInt(e.target.value, 10) })}
        />
        <label htmlFor="simReturn">
          Annual return: <span id="simReturnOut" className="mono">{projection.returnLabel}</span>
        </label>
        <input
          id="simReturn"
          type="range"
          min={0}
          max={15}
          step={0.5}
          value={sim.annual}
          onChange={(e) => onSim({ ...sim, annual: parseFloat(e.target.value) })}
        />
        <div className="foot">A what-if tool — not a forecast or financial advice.</div>
      </article>,
    <article key="result" className="panel sim">
        <PanelHead title="Projection" sub="" />
        <div className="out mono" id="simOut">
          ${fmt(projection.bal, 0)}
        </div>
        <div className="out-sub" id="simOutSub">
          ${fmt(projection.contributed, 0)} contributed · ${fmt(projection.bal - projection.contributed, 0)} growth over {projection.years} years
        </div>
        <div className="chart-box" id="simChart">
          <LineChart data={projection.pts} w={560} h={200} pad={8} label="Projection chart" />
        </div>
        <FootNote>Sample data for layout preview.</FootNote>
      </article>,
  ];
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

export function StockAnalysis({ mode, selected, snapshot, loading }: {
  mode: "fundamental" | "valuation";
  selected: string;
  snapshot: CompanySnapshot | null;
  loading: boolean;
}) {
  return (
    <section className="panels stock-analysis-panels" data-analysis={mode} aria-label={mode === "fundamental" ? "Stock fundamentals" : "Stock valuation"}>
      {mode === "fundamental" ? (
        <Fundamentals ticker={selected} snapshot={snapshot} loading={loading} />
      ) : (
        <ValuationHistory ticker={selected} snapshot={snapshot} loading={loading} />
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
  sim: SimInput;
  onSim: (next: SimInput) => void;
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
    body = <SimulationPanels sim={sim} onSim={onSim} />;
  } else if (section === "learn") {
    body = <LearnPanels />;
  }
  return <section className="panels" id="panels" aria-live="polite">{body}</section>;
}
