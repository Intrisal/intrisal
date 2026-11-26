"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatedPrice } from "@/components/AnimatedPrice";
import { BrandLogo } from "@/components/BrandLogo";
import {
  HelpIcon,
  HomeIcon,
  LearnIcon,
  ListIcon,
  ProfileIcon,
  SearchIcon,
  SimulationIcon,
  WatchlistIcon,
} from "@/components/Icons";
import { Panels, StockAnalysis, type Section } from "@/components/Panels";
import { StockDetail } from "@/components/StockDetail";
import { Stars } from "@/components/Stars";
import { SIM_DEFAULT, exchangeOf, fmt, isKnownFund, nameOf, searchCatalog, type SimInput } from "@/lib/market";
import { useCompanySnapshot } from "@/lib/useCompanyData";
import { useQuotes } from "@/lib/useMarketData";
import { SKY_PAN_MS } from "@/components/landing/intro";
import { decidePlatformArrival, navigateWithCurtain } from "@/lib/routeTransition";
import { signOutAndReload, useSessionUser } from "@/lib/useSessionUser";
import {
  clearLocalWatchlist,
  fetchAccountWatchlist,
  hasMigratedLocalWatchlist,
  markLocalWatchlistMigrated,
  readLocalWatchlist,
  saveAccountWatchlist,
} from "@/lib/watchlistStorage";
import "@/components/landing/landing.css";

type ThemeChoice = "auto" | "light" | "dark";
type MenuId = "profile" | "help";

type NavItem = { id: Section; label: string; icon: ReactNode };

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: <HomeIcon /> },
  { id: "learn", label: "Learn", icon: <LearnIcon /> },
  { id: "simulation", label: "Simulation", icon: <SimulationIcon /> },
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

function watchMotionItems(dock: HTMLDivElement) {
  const selector = window.matchMedia("(max-width: 900px)").matches
    ? ".watch-strip[data-watch-motion]"
    : ".watch-strip [data-watch-motion]";
  return Array.from(dock.querySelectorAll<HTMLElement>(selector));
}

export function Dashboard() {
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("dark");
  const [themeReady, setThemeReady] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchlistReady, setWatchlistReady] = useState(false);
  const [watchlistRemovalPreview, setWatchlistRemovalPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [section, setSection] = useState<Section | "stock">("home");
  const [revealHomeWordmark, setRevealHomeWordmark] = useState(false);
  const [analysis, setAnalysis] = useState<"graph" | "fundamental" | "valuation">("graph");
  const [listOpen, setListOpen] = useState(false);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [query, setQuery] = useState("");
  const [directoryResults, setDirectoryResults] = useState<{ query: string; rows: [string, string][] } | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [sim, setSim] = useState<SimInput>(SIM_DEFAULT);
  const [toastMsg, setToastMsg] = useState("");
  const [toastOn, setToastOn] = useState(false);
  // pending → matches server HTML; layout effect picks pan vs direct before paint.
  const [skyPhase, setSkyPhase] = useState<"pending" | "panning" | "ready" | "direct">("pending");
  const enterFromLanding = skyPhase === "panning" || skyPhase === "ready";
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchDockStart = useRef<DOMRect | null>(null);
  const watchDockRef = useRef<HTMLDivElement>(null);
  const watchDockStart = useRef<Map<string, DOMRect> | null>(null);
  const toastTimer = useRef<number | null>(null);
  const { quotes } = useQuotes(watchlist);
  const { user, loading: sessionLoading } = useSessionUser();

  const watchlistOwner = useRef<string | null>(null);
  const watchlistSaveTimer = useRef<number | null>(null);
  const skipNextWatchlistSave = useRef(false);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user?.id) {
      watchlistOwner.current = null;
      setWatchlist([]);
      setSelected("");
      setWatchlistReady(false);
      return;
    }

    const owner = user.id;
    if (watchlistOwner.current === owner) return;
    watchlistOwner.current = owner;
    setWatchlistReady(false);

    let cancelled = false;
    (async () => {
      try {
        let tickers = await fetchAccountWatchlist();
        if (
          tickers.length === 0 &&
          !hasMigratedLocalWatchlist(owner)
        ) {
          const local = readLocalWatchlist(owner);
          if (local.length) {
            tickers = await saveAccountWatchlist(local);
          }
          markLocalWatchlistMigrated(owner);
          clearLocalWatchlist(owner);
        }
        if (cancelled || watchlistOwner.current !== owner) return;
        skipNextWatchlistSave.current = true;
        setWatchlist(tickers);
        setSelected(tickers[0] || "");
        setWatchlistReady(true);
      } catch {
        if (cancelled || watchlistOwner.current !== owner) return;
        // Fall back to any local list so the UI still works if the table isn't migrated yet.
        const local = readLocalWatchlist(owner);
        skipNextWatchlistSave.current = true;
        setWatchlist(local);
        setSelected(local[0] || "");
        setWatchlistReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionLoading, user?.id]);

  useEffect(() => {
    if (!watchlistReady || !user?.id) return;
    if (skipNextWatchlistSave.current) {
      skipNextWatchlistSave.current = false;
      return;
    }
    if (watchlistSaveTimer.current) window.clearTimeout(watchlistSaveTimer.current);
    watchlistSaveTimer.current = window.setTimeout(() => {
      void saveAccountWatchlist(watchlist).catch(() => undefined);
    }, 400);
    return () => {
      if (watchlistSaveTimer.current) window.clearTimeout(watchlistSaveTimer.current);
    };
  }, [watchlist, watchlistReady, user?.id]);

  useLayoutEffect(() => {
    const dock = watchDockRef.current;
    const start = watchDockStart.current;
    watchDockStart.current = null;
    if (!dock || !start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const animations = watchMotionItems(dock).flatMap((item) => {
      const before = start.get(item.dataset.watchMotion!);
      if (!before) return [];
      const after = item.getBoundingClientRect();
      return [item.animate(
        [{ transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)` }, { transform: "none" }],
        { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      )];
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [section]);

  useLayoutEffect(() => {
    const search = searchRef.current;
    const start = searchDockStart.current;
    searchDockStart.current = null;
    if (!search || !start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const end = search.getBoundingClientRect();
    if (!end.width || !end.height) return;

    // Animate the search wrapper so the outer dock keeps its centering transform.
    const offsetX = start.left - end.left;
    const offsetY = start.top - end.top;
    const scaleX = start.width / end.width;
    const scaleY = start.height / end.height;
    const animation = search.animate(
      [
        { transformOrigin: "top left", transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})` },
        { transformOrigin: "top left", transform: "none" },
      ],
      { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => animation.cancel();
  }, [section]);

  useLayoutEffect(() => {
    const choice = readThemeChoice();
    setThemeChoice(choice);
    setThemeReady(true);
    document.documentElement.setAttribute("data-theme", choice === "auto" ? autoTheme() : choice);
  }, []);

  // Decide before paint — same timing model as AuthPageShell (sky pan + UI ride together).
  useLayoutEffect(() => {
    const arrival = decidePlatformArrival();
    setSkyPhase(arrival === "pan" ? "panning" : "direct");
    try {
      delete document.documentElement.dataset.platformEnter;
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (skyPhase !== "panning") return;
    const timer = window.setTimeout(() => setSkyPhase("ready"), SKY_PAN_MS);
    return () => window.clearTimeout(timer);
  }, [skyPhase]);

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

  function moveToSection(name: Section | "stock") {
    if ((section === "home") !== (name === "home") && watchDockRef.current) {
      const items = watchMotionItems(watchDockRef.current);
      watchDockStart.current = new Map(items.map((item) => [item.dataset.watchMotion!, item.getBoundingClientRect()]));
    }
    if (name !== section) {
      setListOpen(false);
      setRevealHomeWordmark(name === "home");
    }
    setSection(name);
  }

  function changeSection(name: Section) {
    moveToSection(name);
    if (name === "simulation") setSim({ ...SIM_DEFAULT });
  }

  function goHome() {
    if (section !== "home") {
      searchDockStart.current = searchRef.current?.getBoundingClientRect() ?? null;
    }
    moveToSection("home");
    setResultsOpen(false);
    setActiveIdx(-1);
    setQuery("");
    setListOpen(false);
    setMenu(null);
  }

  function bumpWatchlist(tk: string, list = watchlist) {
    return [tk, ...list.filter((x) => x !== tk)];
  }

  function addToWatchlist(tk: string) {
    setWatchlist((list) => bumpWatchlist(tk, list));
    setSelected(tk);
    toast(tk + " added to your watchlist");
  }

  function removeFromWatchlist(tk: string) {
    setWatchlist((list) => {
      const next = list.filter((x) => x !== tk);
      if (section !== "stock") {
        setSelected((current) => (current === tk ? (next[0] || "") : current));
      }
      return next;
    });
    setListOpen(false);
    toast(tk + " removed from your watchlist");
  }

  function createWatchlist() {
    changeSection("watchlist");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function showStock(tk: string) {
    if (section !== "stock") {
      searchDockStart.current = searchRef.current?.getBoundingClientRect() ?? null;
    }
    setAnalysis("graph");
    setSelected(tk);
    moveToSection("stock");
  }

  function openStock(tk: string) {
    setWatchlist((list) => (list.includes(tk) ? bumpWatchlist(tk, list) : list));
    setListOpen(false);
    showStock(tk);
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

  useEffect(() => {
    const term = query.trim();
    if (!resultsOpen || term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch("/api/stock/search?q=" + encodeURIComponent(term), { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<[string, string][]> : [])
        .then((rows) => {
          if (!controller.signal.aborted) setDirectoryResults({ query, rows });
        })
        .catch(() => undefined);
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, resultsOpen]);

  const localMatches = searchCatalog(query);
  const remoteMatches = directoryResults?.query === query ? directoryResults.rows : [];
  const matches = resultsOpen
    ? [...localMatches, ...remoteMatches.filter(([ticker]) => !localMatches.some(([local]) => local === ticker))].slice(0, 8)
    : [];

  function pickResult(tk: string) {
    setWatchlist((list) => (list.includes(tk) ? bumpWatchlist(tk, list) : list));
    setQuery("");
    closeResults();
    showStock(tk);
    toast(tk + " — " + nameOf(tk));
  }

  function addResult(tk: string) {
    addToWatchlist(tk);
    setQuery("");
    closeResults();
  }

  const isStock = section === "stock";
  const selectedIsWatched = watchlist.includes(selected);
  const previewWatchlistRemoval = selectedIsWatched && watchlistRemovalPreview === selected;
  const { snapshot, loading: snapshotLoading } = useCompanySnapshot(isStock ? selected : "");
  const selectedSnapshot = snapshot?.ticker === selected ? snapshot : null;
  const selectedSnapshotLoading = snapshotLoading || (snapshot !== null && selectedSnapshot === null);
  const canUseCompanyAnalysis = !isKnownFund(selected) && (
    exchangeOf(selected) !== undefined || selectedSnapshot?.isFund === false
  );
  const stockAnalysis = canUseCompanyAnalysis ? analysis : "graph";
  const wordmark = (
    <h1 className="wordmark" data-home-reveal={revealHomeWordmark}>
      <button type="button" onClick={goHome} aria-label="Intrisal home">
        {Array.from("Intrisal", (letter, index) => (
          <span key={index} aria-hidden="true" style={{ animationDelay: `${360 + index * 28}ms` }}>{letter}</span>
        ))}
      </button>
    </h1>
  );

  function onSearchKey(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!matches.length) return;
      setActiveIdx((idx) => (ev.key === "ArrowDown" ? Math.min(idx + 1, matches.length - 1) : Math.max(idx - 1, 0)));
    } else if (ev.key === "Enter") {
      const match = matches[Math.max(0, activeIdx)];
      if (match) pickResult(match[0]);
    } else if (ev.key === "Escape") {
      closeResults();
      ev.currentTarget.blur();
    }
  }

  const themePressed = (choice: ThemeChoice) => (themeReady ? themeChoice === choice : choice === "dark");

  return (
    <>
      <div
        className={
          "platform-sky" +
          (enterFromLanding ? " is-sky-pan-right" : "") +
          (skyPhase !== "panning" ? " is-ready" : "")
        }
        aria-hidden="true"
      >
        {/* One sky tree always — swapping Stars remounts and chops the arrival pan. */}
        <div className="landing-cosmos">
          <Stars />
          <div className="aurora" />
        </div>
      </div>
      <div
        className={
          "shell" +
          (skyPhase === "pending" ? " platform-enter-hold" : "") +
          (enterFromLanding ? " platform-enter" : "") +
          (skyPhase === "ready" || skyPhase === "direct" ? " is-enter-ready" : "")
        }
      >
        <header className={isStock ? "topbar stock-topbar" : "topbar"}><div className="left">
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
            <div className={"menu left-menu menu-compact" + (menu === "profile" ? " open" : "")} id="profileMenu" role="menu" aria-label="Profile menu" onClick={(ev) => ev.stopPropagation()}>
              {user ? (
                <>
                  <p className="profile-user-name">{user.name}</p>
                  <p className="profile-user-email">{user.email}</p>
                </>
              ) : (
                <h3>Profile</h3>
              )}
              <button
                type="button"
                className="menu-link"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void navigateWithCurtain("/", "to-landing");
                }}
              >
                Back to Home
              </button>
              <div className="row-label">Appearance</div>
              <div className="seg" role="group" aria-label="Theme">{(["auto", "light", "dark"] as const).map((choice) => (
                  <button key={choice} type="button" data-theme-choice={choice} aria-pressed={themePressed(choice)} onClick={() => chooseTheme(choice)}>
                    {choice === "auto" ? "Auto" : choice === "light" ? "Light" : "Dark"}
                  </button>
                ))}</div>
              {user ? (
                <div className="menu-signout-block">
                  <button
                    type="button"
                    className="menu-link menu-signout"
                    role="menuitem"
                    onClick={() => void signOutAndReload()}
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div><div className="right">
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
                <strong>Search</strong> — type a ticker or company name (or press <span className="mono">/</span>). Open a result to view it, or choose <strong>Add +</strong> to put it on your watchlist.
              </p>
              <p>
                <strong>Watchlist</strong> — saved to your account across devices. Home shows up to eight of your most recently viewed watchlist stocks. Manage the full list (and remove stocks) in the Watchlist section.
              </p>
              <p style={{ marginBottom: 0 }}>
                <strong>Sections</strong> — use the dock to open Home, Learn, Simulation, or Watchlist. Open a stock to see its Graph Analysis, Fundamental, and Valuation views.
              </p>
            </div>
          </div></header>

        <div className={"layout" + (section === "home" || isStock ? " " + section : "")} id="layout"><nav className="sidenav" aria-label="Sections">
            <div className="sidenav-dock" id="navDock">
              <ul id="navList">
                {NAV_ITEMS.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-section={item.id}
                      aria-current={section === item.id ? "page" : undefined}
                      aria-label={item.label}
                      onClick={item.id === "home" ? goHome : () => changeSection(item.id)}
                    >
                      <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                      <span className="nav-label">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </nav><main className="center"><div className="search-dock">{!isStock && wordmark}<div className="search-wrap" ref={searchRef}>
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
                      <div
                        key={entry[0]}
                        role="option"
                        aria-selected={i === activeIdx}
                        className={"result-row" + (i === activeIdx ? " active" : "")}
                        onMouseMove={() => setActiveIdx(i)}
                      >
                        <button type="button" className="result-main" onClick={() => pickResult(entry[0])}>
                          <span className="tk">{entry[0]}</span>
                          <span className="nm">{entry[1]}</span>
                        </button>
                        {inList ? (
                          <span className="tag in">Watching</span>
                        ) : (
                          <button type="button" className="tag add" onClick={() => addResult(entry[0])}>
                            Add +
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div></div>
            <div className="watch-dock" ref={watchDockRef}>
              {watchlistReady && watchlist.length === 0 && section === "home" ? (
                <button type="button" className="watch-create" onClick={createWatchlist}>
                  <WatchlistIcon />
                  <span>Create watchlist</span>
                </button>
              ) : null}
              {watchlist.length > 0 ? (
                <>
                  <div className="watch-strip" data-watch-motion="strip" role="group" aria-label="Stock shortcuts">
                    <div className="watch-row" id="watchRow">
                      {watchlist.slice(0, 8).map((tk) => (
                        <div key={tk} data-watch-motion={tk} className={"watch-chip" + (tk === selected ? " selected" : "")}>
                          <span className="coin-wrap">
                            <button type="button" className="coin" aria-label={"View " + tk + " — " + nameOf(tk)} onClick={() => openStock(tk)}><BrandLogo tk={tk} /></button>
                            <span className="watch-tooltip" aria-hidden="true">{nameOf(tk)}</span>
                          </span>
                          <div className="ticker">{tk}</div>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="list-tile" data-watch-motion="list" aria-label="Watchlist" aria-expanded={listOpen} aria-controls="watchList" onClick={() => setListOpen((open) => !open)}><ListIcon /><span>Watchlist</span></button>
                  </div>
                  <div className={"watch-list" + (listOpen ? " open" : "")} id="watchList" aria-label="Full watchlist">
                    {listOpen && watchlist.map((tk) => {
                      const live = quotes[tk];
                      const quote = live?.source === "marketstack" ? live : null;
                      const up = (quote?.change ?? 0) >= 0;
                      return (
                        <button type="button" key={tk} onClick={() => openStock(tk)}>
                          <span className="tk">{tk}</span><span className="nm">{nameOf(tk)}</span>
                          <span className="mono" title={quote ? "Close as of " + quote.date : undefined}>
                            {quote ? <AnimatedPrice price={quote.price} /> : "—"}
                          </span>
                          <span className="mono">{quote ? <span className={up ? "chg-up" : "chg-dn"}>
                            {up ? "▲ +" : "▼ "}{fmt(quote.change, 2)}%
                          </span> : "—"}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
            {isStock && selected ? (
              <div className="stock-overview">
                <h2 className="stock-identity">
                  <span className="stock-identity-logo" aria-hidden="true"><BrandLogo tk={selected} /></span>
                  <span className="stock-identity-text">
                    <strong>{nameOf(selected)}</strong>
                    <span>{[selected, exchangeOf(selected)].filter(Boolean).join(" | ")}</span>
                  </span>
                </h2>
                <button
                  key={selected}
                  type="button"
                  className="stock-watchlist-button"
                  data-added={selectedIsWatched}
                  data-removing={previewWatchlistRemoval}
                  disabled={!watchlistReady}
                  aria-label={selectedIsWatched && !previewWatchlistRemoval ? "Added to Watchlist. Remove from Watchlist" : undefined}
                  onPointerEnter={(event) => {
                    if (selectedIsWatched && event.pointerType !== "touch") setWatchlistRemovalPreview(selected);
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType !== "touch") setWatchlistRemovalPreview(null);
                  }}
                  onFocus={(event) => {
                    if (selectedIsWatched && event.currentTarget.matches(":focus-visible")) setWatchlistRemovalPreview(selected);
                  }}
                  onBlur={() => setWatchlistRemovalPreview(null)}
                  onClick={(event) => {
                    if (!selectedIsWatched) {
                      addToWatchlist(selected);
                    } else if (previewWatchlistRemoval || event.detail === 0) {
                      setWatchlistRemovalPreview(null);
                      removeFromWatchlist(selected);
                    } else {
                      setWatchlistRemovalPreview(selected);
                    }
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path className="stock-watchlist-plus" d="M10 5v10M5 10h10" />
                    <path className="stock-watchlist-check" pathLength={1} d="m5 10 3.2 3.2L15 6.6" />
                    <path className="stock-watchlist-remove" d="m6 6 8 8m0-8-8 8" />
                  </svg>
                  <span>{previewWatchlistRemoval ? "Remove from Watchlist" : selectedIsWatched ? "Added to Watchlist" : "Add to Watchlist"}</span>
                </button>
              </div>
            ) : null}
            {isStock && selected ? (
              <div className="stock-analysis-switch" role="group" aria-label="Stock analysis"
                data-analysis={stockAnalysis} data-graph-only={!canUseCompanyAnalysis}>
                <button type="button" aria-pressed={stockAnalysis === "graph"} onClick={() => setAnalysis("graph")}>Graph Analysis</button>
                {canUseCompanyAnalysis && <>
                  <button type="button" aria-pressed={stockAnalysis === "fundamental"} onClick={() => setAnalysis("fundamental")}>Fundamental</button>
                  <button type="button" aria-pressed={stockAnalysis === "valuation"} onClick={() => setAnalysis("valuation")}>Valuation</button>
                </>}
              </div>
            ) : null}
            <div key={section === "stock" ? "stock:" + selected : section} className="section-stage">
              {section === "stock" && selected ? (
                <>
                  <div className="stock-analysis-pane" hidden={stockAnalysis !== "graph"}>
                    <StockDetail ticker={selected} snapshot={selectedSnapshot} />
                  </div>
                  {canUseCompanyAnalysis && <>
                    <div className="stock-analysis-pane" hidden={stockAnalysis !== "fundamental"}>
                      <StockAnalysis mode="fundamental" selected={selected} snapshot={selectedSnapshot} loading={selectedSnapshotLoading} />
                    </div>
                    <div className="stock-analysis-pane" hidden={stockAnalysis !== "valuation"}>
                      <StockAnalysis mode="valuation" selected={selected} snapshot={selectedSnapshot} loading={selectedSnapshotLoading} />
                    </div>
                  </>}
                </>
              ) : section !== "stock" ? (
                <Panels
                  section={section}
                  selected={selected}
                  watchlist={watchlist}
                  onSelect={openStock}
                  onRemove={removeFromWatchlist}
                  sim={sim}
                  onSim={setSim}
                />
              ) : null}
            </div>
          </main></div>
      </div>
      <div className={"toast" + (toastOn ? " show" : "")} id="toast" role="status">
        {toastMsg}
      </div>
    </>
  );
}
