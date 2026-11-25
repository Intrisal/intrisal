"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatedPrice } from "@/components/AnimatedPrice";
import { BrandLogo } from "@/components/BrandLogo";
import {
  FundamentalIcon,
  HelpIcon,
  HomeIcon,
  LearnIcon,
  ListIcon,
  ProfileIcon,
  SearchIcon,
  SimulationIcon,
  ValuationIcon,
  WatchlistIcon,
} from "@/components/Icons";
import { Panels, type Section } from "@/components/Panels";
import { StockDetail } from "@/components/StockDetail";
import { Stars } from "@/components/Stars";
import { DEFAULT_WATCHLIST, SIM_DEFAULT, fmt, nameOf, sample, searchCatalog, type SimInput } from "@/lib/market";

type ThemeChoice = "auto" | "light" | "dark";
type MenuId = "profile" | "help";

const SECTIONS: Array<{ id: Section; label: string; icon: ReactNode }> = [
  { id: "home", label: "Home", icon: <HomeIcon /> },
  { id: "fundamental", label: "Fundamental", icon: <FundamentalIcon /> },
  { id: "learn", label: "Learn", icon: <LearnIcon /> },
  { id: "simulation", label: "Simulation", icon: <SimulationIcon /> },
  { id: "valuation", label: "Valuation", icon: <ValuationIcon /> },
  { id: "watchlist", label: "Watchlist", icon: <WatchlistIcon /> },
];

function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem("intrisal-theme-choice");
    if (saved === "auto" || saved === "light" || saved === "dark") return saved;
  } catch {}
  return "dark";
}

function autoTheme() {
  const h = new Date().getHours();
  return h >= 7 && h < 19 ? "light" : "dark";
}

export function Dashboard() {
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("dark");
  const [themeReady, setThemeReady] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST);
  const [selected, setSelected] = useState("NVDA");
  const [section, setSection] = useState<Section | "stock">("home");
  const [range, setRange] = useState("1Y");
  const [listOpen, setListOpen] = useState(false);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [query, setQuery] = useState("");
  const [resultsOpen, setResultsOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [sim, setSim] = useState<SimInput>(SIM_DEFAULT);
  const [toastMsg, setToastMsg] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchDockRef = useRef<HTMLDivElement>(null);
  const searchDockStart = useRef<DOMRect | null>(null);
  const toastTimer = useRef<number | null>(null);

  useLayoutEffect(() => {
    const dock = searchDockRef.current;
    const start = searchDockStart.current;
    searchDockStart.current = null;
    if (!dock || !start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const end = dock.getBoundingClientRect();
    if (!end.width) return;

    // Animate between the measured positions so the same motion works on narrow screens.
    const offsetX = start.left + start.width / 2 - end.left - end.width / 2;
    const offsetY = start.top - end.top;
    const scale = start.width / end.width;
    const animation = dock.animate(
      [{ transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})` }, { transform: "none" }],
      { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => animation.cancel();
  }, [section]);

  useEffect(() => {
    setThemeChoice(readThemeChoice());
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    const t = themeChoice === "auto" ? autoTheme() : themeChoice;
    document.documentElement.setAttribute("data-theme", t);
  }, [themeChoice, themeReady]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const input = inputRef.current;
      const tag = document.activeElement?.tagName ?? "";
      if (ev.key === "/" && document.activeElement !== input && !/INPUT|TEXTAREA/.test(tag)) {
        ev.preventDefault();
        input?.focus();
      }
    }
    function onClick(ev: MouseEvent) {
      const target = ev.target instanceof Element ? ev.target : null;
      if (searchRef.current && target && !searchRef.current.contains(target)) {
        setResultsOpen(false);
        setActiveIdx(-1);
      }
      if (target?.closest(".menu, #profileBtn, #helpBtn")) return;
      setMenu(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  function toast(msg: string) {
    setToastMsg(msg);
    setToastOn(true);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(function () {
      setToastOn(false);
    }, 2400);
  }

  function chooseTheme(choice: ThemeChoice) {
    setThemeChoice(choice);
    setThemeReady(true);
    try {
      localStorage.setItem("intrisal-theme-choice", choice);
    } catch {}
  }

  function toggleMenu(id: MenuId, ev: React.MouseEvent) {
    ev.stopPropagation();
    setMenu((open) => (open === id ? null : id));
  }

  function changeSection(name: Section) {
    if (name === "home" && section !== "home") {
      searchDockStart.current = searchDockRef.current?.getBoundingClientRect() ?? null;
    }
    setSection(name);
    if (name === "simulation") setSim({ ...SIM_DEFAULT });
  }

  function selectStock(tk: string) {
    setSelected(tk);
    if (section === "simulation") setSim({ ...SIM_DEFAULT });
  }

  function openStock(tk: string) {
    if (section === "home") {
      searchDockStart.current = searchDockRef.current?.getBoundingClientRect() ?? null;
    }
    setSelected(tk);
    setSection("stock");
  }

  function removeStock(tk: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    const next = watchlist.filter((x) => x !== tk);
    setWatchlist(next);
    if (selected === tk && next.length) setSelected(next[0]);
    if (section === "simulation") setSim({ ...SIM_DEFAULT });
    toast(tk + " removed from your watchlist");
  }

  function runSearch(value: string) {
    setQuery(value);
    const matches = searchCatalog(value);
    if (!value.trim()) {
      setResultsOpen(false);
      setActiveIdx(-1);
      return;
    }
    setActiveIdx(matches.length ? 0 : -1);
    setResultsOpen(true);
  }

  function closeResults() {
    setResultsOpen(false);
    setActiveIdx(-1);
  }

  const matches = resultsOpen ? searchCatalog(query) : [];

  function pickResult(tk: string) {
    const added = watchlist.indexOf(tk) === -1;
    if (added) setWatchlist(watchlist.concat(tk));
    setQuery("");
    closeResults();
    openStock(tk);
    toast(added ? tk + " added to your watchlist" : tk + " — " + nameOf(tk));
  }

  function onSearchKey(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!matches.length) return;
      setActiveIdx((idx) => (ev.key === "ArrowDown" ? Math.min(idx + 1, matches.length - 1) : Math.max(idx - 1, 0)));
    } else if (ev.key === "Enter") {
      if (activeIdx >= 0 && matches[activeIdx]) pickResult(matches[activeIdx][0]);
    } else if (ev.key === "Escape") {
      closeResults();
      ev.currentTarget.blur();
    }
  }

  const themePressed = (choice: ThemeChoice) => (themeReady ? themeChoice === choice : choice === "dark");

  return (
    <>
      <Stars />
      <div className="aurora" aria-hidden="true" />
      <div className="shell">
        <header className="topbar"><div className="left">
            <button
              className="icon-btn"
              id="profileBtn"
              aria-label="Profile"
              aria-haspopup="true"
              aria-expanded={menu === "profile"}
              onClick={(ev) => toggleMenu("profile", ev)}
            >
              <ProfileIcon />
            </button>
            <div className={"menu left-menu" + (menu === "profile" ? " open" : "")} id="profileMenu" role="menu" aria-label="Profile menu" onClick={(ev) => ev.stopPropagation()}>
              <h3>Profile</h3>
              <p>Signed-in accounts arrive with the full v2 build. Appearance lives here for now.</p>
              <div className="row-label">Appearance</div>
              <div className="seg" role="group" aria-label="Theme">{(["auto", "light", "dark"] as const).map((choice) => (
                  <button key={choice} type="button" data-theme-choice={choice} aria-pressed={themePressed(choice)} onClick={() => chooseTheme(choice)}>
                    {choice === "auto" ? "Auto" : choice === "light" ? "Light" : "Dark"}
                  </button>
                ))}</div>
              <p style={{ margin: "12px 0 0" }}>Auto follows the time of day — light in the day, dark at night.</p>
            </div>
          </div><h1 className="wordmark">Intrisal</h1><div className="right">
            <button className="icon-btn" id="helpBtn" aria-label="Help" aria-haspopup="true" aria-expanded={menu === "help"} onClick={(ev) => toggleMenu("help", ev)}>
              <HelpIcon />
            </button>
            <div
              className={"menu right-menu" + (menu === "help" ? " open" : "")}
              id="helpMenu"
              role="menu"
              aria-label="Help menu"
              style={{ minWidth: "min(320px, calc(100vw - 32px))" }}
              onClick={(ev) => ev.stopPropagation()}
            >
              <h3>Help</h3>
              <p>
                <strong>Search</strong> — type a ticker or company name (or press <span className="mono">/</span>) and pick a result to add it to your watchlist and open it below.
              </p>
              <p>
                <strong>Watchlist</strong> — the circles under the search bar are your watched stocks. Tap one to view it; the <strong>list</strong> tile switches to a full list.
              </p>
              <p style={{ marginBottom: 0 }}>
                <strong>Sections</strong> — use the menu on the left to switch between Home (search bar with your watchlist under it), Fundamental, Learn, Simulation, Valuation and Watchlist.
              </p>
            </div>
          </div></header>

        <div className={"layout" + (section === "home" || section === "stock" ? " " + section : "")} id="layout"><nav className="sidenav" aria-label="Sections">
            <div className="sidenav-dock" id="navDock">
              <ul id="navList">{SECTIONS.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-section={item.id}
                      aria-current={section === item.id ? "page" : undefined}
                      aria-label={item.label}
                      onClick={() => changeSection(item.id)}
                    ><span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-label">{item.label}</span></button>
                  </li>
                ))}</ul>
            </div>
          </nav><main className="center"><div className="search-dock" ref={searchDockRef}><div className="search-wrap" ref={searchRef}>
              <div className="search-bar"><SearchIcon /><input
                  ref={inputRef}
                  id="searchInput"
                  type="search"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Search stocks: ticker or name"
                  aria-label="Search stocks"
                  aria-expanded={resultsOpen}
                  aria-controls="results"
                  role="combobox"
                  aria-autocomplete="list"
                  value={query}
                  onChange={(ev) => runSearch(ev.target.value)}
                  onFocus={(ev) => runSearch(ev.target.value)}
                  onKeyDown={onSearchKey}
                /><kbd>/</kbd></div>
              <div className={"results" + (resultsOpen ? " open" : "")} id="results" role="listbox" aria-label="Search results">
                {resultsOpen && matches.length === 0 && <div className="empty">No matches for “{query.trim()}”.</div>}
                {resultsOpen &&
                  matches.map(function (entry, i) {
                    const inList = watchlist.indexOf(entry[0]) !== -1;
                    return (
                      <button
                        type="button"
                        key={entry[0]}
                        role="option"
                        className={i === activeIdx ? "active" : ""}
                        onClick={() => pickResult(entry[0])}
                        onMouseMove={() => setActiveIdx(i)}
                      >
                        <span className="tk">{entry[0]}</span><span className="nm">{entry[1]}</span><span className={"tag" + (inList ? " in" : "")}>{inList ? "Watching" : "Add +"}</span>
                      </button>
                    );
                  })}
              </div>
            </div><div className="watch-row" id="watchRow" aria-label="Watchlist">{watchlist.map((tk) => (
                <div key={tk} className={"watch-chip" + (tk === selected ? " selected" : "")}><span className="coin-wrap"><button type="button" className="coin" aria-label={"View " + tk + " — " + nameOf(tk)} onClick={() => openStock(tk)}><BrandLogo tk={tk} /></button><button type="button" className="rm" aria-label={"Remove " + tk + " from watchlist"} onClick={(ev) => removeStock(tk, ev)}>×</button></span><div className="ticker mono">{tk}</div></div>
              ))}<button type="button" className="list-tile" aria-expanded={listOpen} onClick={() => setListOpen((open) => !open)}><ListIcon />list</button></div><div className={"watch-list" + (listOpen ? " open" : "")} id="watchList" aria-label="Watchlist as list">
              {listOpen && watchlist.map((tk) => {
                const s = sample(tk);
                const up = s.change >= 0;
                return (
                  <button type="button" key={tk} onClick={() => openStock(tk)}><span className="tk">{tk}</span><span className="nm">{nameOf(tk)}</span><span className="mono"><AnimatedPrice price={s.price} /></span><span className="mono"><span className={up ? "chg-up" : "chg-dn"}>{up ? "▲" : "▼"} {up ? "+" : ""}{fmt(s.change, 2)}%</span></span></button>
                );
              })}
            </div></div>{section === "stock" ? <StockDetail key={selected} ticker={selected} /> : <Panels section={section} selected={selected} watchlist={watchlist} range={range} onRange={setRange} onSelect={selectStock} sim={sim} onSim={setSim} />}<footer className="note">Landing page preview — prices and figures shown are sample data for layout only.</footer></main></div>
      </div>
      <div className={"toast" + (toastOn ? " show" : "")} id="toast" role="status">
        {toastMsg}
      </div>
    </>
  );
}
