/**
 * SEC EDGAR / data.sec.gov client.
 * Fair-access: identifying User-Agent, ~2–5 req/s, disk cache, no polling from the UI.
 * https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { isKnownFund } from "@/lib/market";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const FUNDS_URL = "https://www.sec.gov/files/company_tickers_mf.json";
const FACTS_URL = (cik: number) =>
  `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;

const CACHE_DIR = path.join(process.cwd(), ".cache");
const TICKERS_FILE = path.join(CACHE_DIR, "sec-tickers.json");
const FACTS_DIR = path.join(CACHE_DIR, "sec-facts");
const TICKERS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FACTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EPS_SPLIT_BASIS_VERSION = 3;
export type ReportingCurrency = "USD" | "EUR";

/** Minimum gap between SEC requests (ms). */
const MIN_GAP_MS = 250;

let lastRequestAt = 0;

export type FactPoint = {
  end: string;
  start?: string;
  val: number;
  form?: string;
  filed?: string;
  frame?: string;
  fy?: number;
  fp?: string;
  accn?: string;
};

export type QuarterlySeries = {
  ends: string[];
  values: number[]; // same length; units noted by caller
};

export type EdgarFundamentals = {
  ticker: string;
  cik: number;
  entityName: string;
  asOf: string;
  filingAccession?: string;
  epsSplitBasisVersion?: number;
  epsSplitBasis?: string;
  reportingCurrency?: ReportingCurrency;
  /** Quarterly revenue, USD billions */
  revenue: QuarterlySeries;
  /** Quarterly operating income, USD billions */
  operatingIncome: QuarterlySeries;
  /** Diluted EPS per share. The legacy ASML 6-K series is already trailing 12 months. */
  dilutedEps: QuarterlySeries;
  /** Quarterly free cash flow approx (CFO - capex), USD billions */
  freeCashFlow: QuarterlySeries;
  tax: QuarterlySeries;
  pretax: QuarterlySeries;
  balances: Record<string, { debt: number | null; cash: number | null; shares: number | null; sti?: number | null }>;
  /** Instant shares outstanding (billions) */
  sharesOutstandingBillions: number | null;
  /** Instant cash, USD billions */
  cashBillions: number | null;
  /** Instant interest-bearing debt approx, USD billions */
  debtBillions: number | null;
  /** Instant stockholders' equity, USD billions */
  equityBillions: number | null;
  /** Latest annualized dividend per share (USD), if any */
  dividendPerShare: number | null;
  /** Last period end date from income statement */
  lastReportEnd: string | null;
  source: "edgar" | "edgar-6k";
};

type TickersFile = {
  at: number;
  map: Record<string, number>;
  names?: Record<string, string>;
};

function userAgent() {
  const raw = process.env.SEC_USER_AGENT?.replace(/[\r\n]+/g, " ").trim();
  return raw || "Intrisal contact@intrisal.com";
}

async function secFetch(url: string): Promise<Response> {
  const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const res = await fetch(url, {
    headers: {
      "User-Agent": userAgent(),
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`SEC ${res.status} for ${url}`);
  }
  return res;
}

/** Best-effort mkdir — Vercel /var/task is read-only, so never throw. */
function ensureDir(dir: string) {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function readJsonFile<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(file: string, value: unknown) {
  try {
    if (!ensureDir(path.dirname(file))) return;
    writeFileSync(file, JSON.stringify(value), "utf8");
  } catch {
    /* read-only fs — Supabase is the durable cache in production */
  }
}

/** Load ticker → CIK map (cached 7 days). */
let tickerDirectory: TickersFile | undefined;
let tickerRequest: Promise<TickersFile> | undefined;

async function fetchTickerDirectory(): Promise<TickersFile> {
  const cached = readJsonFile<TickersFile>(TICKERS_FILE);
  if (cached?.names && Date.now() - cached.at < TICKERS_TTL_MS) return cached;

  const res = await secFetch(TICKERS_URL);
  const raw = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const map: Record<string, number> = {};
  const names: Record<string, string> = {};
  for (const row of Object.values(raw)) {
    if (!row?.ticker) continue;
    map[row.ticker.toUpperCase()] = row.cik_str;
    names[row.ticker.toUpperCase()] = row.title;
  }
  // Intrisal catalog aliases
  if (map["BRK-B"] && !map["BRK.B"]) map["BRK.B"] = map["BRK-B"];
  const directory = { at: Date.now(), map, names };
  writeJsonFile(TICKERS_FILE, directory);
  return directory;
}

async function getTickerDirectory() {
  if (tickerDirectory && Date.now() - tickerDirectory.at < TICKERS_TTL_MS) return tickerDirectory;
  tickerRequest ??= fetchTickerDirectory().then((directory) => {
    tickerDirectory = directory;
    return directory;
  }).finally(() => { tickerRequest = undefined; });
  return tickerRequest;
}

export async function loadCikMap() {
  return (await getTickerDirectory()).map;
}

let fundDirectory: { at: number; symbols: Set<string> } | undefined;
let fundRequest: Promise<Set<string>> | undefined;

async function loadFundSymbols() {
  if (fundDirectory && Date.now() - fundDirectory.at < TICKERS_TTL_MS) return fundDirectory.symbols;
  fundRequest ??= (async () => {
    const response = await secFetch(FUNDS_URL);
    const { fields, data } = await response.json() as { fields: string[]; data: unknown[][] };
    const tickerIndex = fields.indexOf("symbol");
    if (tickerIndex < 0) throw new Error("SEC fund directory has no symbol column");
    const symbols = new Set(data.map((row) => row[tickerIndex]).filter(
      (symbol): symbol is string => typeof symbol === "string",
    ).map((symbol) => symbol.toUpperCase()));
    fundDirectory = { at: Date.now(), symbols };
    return symbols;
  })().finally(() => { fundRequest = undefined; });
  return fundRequest;
}

export async function lookupStockKind(ticker: string): Promise<"company" | "fund" | null> {
  if (isKnownFund(ticker)) return "fund";
  const directory = await getTickerDirectory();
  const name = directory.names?.[ticker] ?? "";
  if (/\b(?:ETFS?|EXCHANGE[- ]TRADED FUND)\b/i.test(name)) return "fund";
  if ((await loadFundSymbols()).has(ticker)) return "fund";
  return Object.hasOwn(directory.map, ticker) ? "company" : null;
}

// Alphabet's convertible preferred depositary shares are outside stock search.
const SEARCH_EXCLUDED_TICKERS = new Set(["GOOGM", "GOOGN"]);

export async function searchEdgarTickers(query: string) {
  const term = query.toUpperCase();
  if (SEARCH_EXCLUDED_TICKERS.has(term)) return [];
  const { names } = await getTickerDirectory();
  const matches = Object.entries(names ?? {})
    .filter(([ticker, name]) => !SEARCH_EXCLUDED_TICKERS.has(ticker)
      && (ticker.startsWith(term) || name.toUpperCase().includes(term)));
  if (/^[A-Z][A-Z0-9]{1,7}$/.test(term) && !matches.some(([ticker]) => ticker === term)) {
    const funds = await loadFundSymbols().catch(() => null);
    if (funds?.has(term)) matches.push([term, "Fund"]);
  }
  return matches
    .sort(([a], [b]) => Number(b === term) - Number(a === term) || a.length - b.length || a.localeCompare(b))
    .slice(0, 8);
}

export async function resolveCik(ticker: string): Promise<number | null> {
  const id = ticker.trim().toUpperCase();
  // ETFs / funds are not in company_tickers the same way for XBRL facts we need.
  if (isKnownFund(id)) return null;
  const map = await loadCikMap();
  return map[id] ?? map[id.replace(/\./g, "-")] ?? null;
}

type CompanyFacts = {
  cik: number;
  entityName?: string;
  facts?: Record<string, Record<string, { units?: Record<string, FactPoint[]> }>>;
};

async function loadCompanyFacts(cik: number, refresh = false): Promise<CompanyFacts> {
  const file = path.join(FACTS_DIR, `CIK${String(cik).padStart(10, "0")}.json`);
  const cached = readJsonFile<{ at: number; body: CompanyFacts }>(file);
  if (!refresh && cached && Date.now() - cached.at < FACTS_TTL_MS) return cached.body;

  const res = await secFetch(FACTS_URL(cik));
  const body = (await res.json()) as CompanyFacts;
  writeJsonFile(file, { at: Date.now(), body });
  return body;
}

export async function latestFinancialFiling(cik: number) {
  const response = await secFetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
  const data = await response.json() as {
    filings?: { recent?: { form: string[]; accessionNumber: string[]; isXBRL?: (number | boolean)[] } };
  };
  const recent = data.filings?.recent;
  if (!recent || !Array.isArray(recent.form) || !Array.isArray(recent.accessionNumber)) {
    throw new Error("SEC submissions response is missing filing details");
  }
  const index = recent.form.findIndex((form, i) =>
    /^(10-K|10-Q|20-F|40-F)(\/A)?$/.test(form) &&
    recent.isXBRL?.[i] !== 0 && recent.isXBRL?.[i] !== false && Boolean(recent.accessionNumber[i]),
  );
  return index < 0 ? undefined : recent.accessionNumber[index];
}

function daysBetween(start?: string, end?: string) {
  if (!start || !end) return null;
  const a = Date.parse(start + "T00:00:00Z");
  const b = Date.parse(end + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function pickUnit(
  facts: CompanyFacts,
  tags: string[],
  unitKeys: string[] = ["USD", "EUR"],
): FactPoint[] {
  // Prefer US-GAAP, then IFRS — foreign 20-F filers often use EUR.
  for (const ns of ["us-gaap", "ifrs-full"] as const) {
    const bag = facts.facts?.[ns] ?? {};
    for (const tag of tags) {
      const node = bag[tag];
      if (!node?.units) continue;
      for (const unit of unitKeys) {
        const pts = node.units[unit];
        if (pts?.length) return pts;
      }
    }
  }
  return [];
}

/**
 * Prefer the concept with the latest quarterly coverage (and longest series).
 * First-hit order is wrong when an older tag still has a few stale quarters
 * (e.g. NVDA RevenueFromContract… stops in 2019 while Revenues continues).
 */
function pickBestUnit(facts: CompanyFacts, tags: string[], unitKeys: string[]): FactPoint[] {
  let best: FactPoint[] = [];
  let bestScore = -1;
  for (const tag of tags) {
    const pts = pickUnit(facts, [tag], unitKeys);
    if (!pts.length) continue;
    const q = quarterlyPoints(pts);
    if (!q.length) continue;
    const latestMs = Date.parse(q[q.length - 1].end + "T00:00:00Z") || 0;
    const score = latestMs + q.length;
    if (score > bestScore) {
      bestScore = score;
      best = pts;
    }
  }
  return best;
}

function isQuarterDuration(p: FactPoint) {
  const d = daysBetween(p.start, p.end);
  return d !== null && d >= 70 && d <= 110;
}

function isAnnualDuration(p: FactPoint) {
  if (p.frame && /^CY\d{4}$/.test(p.frame)) return true;
  if (p.fp === "FY") {
    const d = daysBetween(p.start, p.end);
    return d !== null && d >= 350 && d <= 380;
  }
  const d = daysBetween(p.start, p.end);
  return d !== null && d >= 350 && d <= 380;
}

/**
 * SEC often omits Q4 as a standalone fact and only files the full year.
 * Derive the missing quarter: Q4 = FY − (Q1+Q2+Q3) when exactly three
 * in-year quarters exist (common for MSFT and peers).
 */
function deriveMissingQuarters(quarters: FactPoint[], allPoints: FactPoint[], additive: boolean): FactPoint[] {
  const byEnd = new Map<string, FactPoint>();
  for (const q of quarters) {
    if (!q.end || typeof q.val !== "number") continue;
    const prev = byEnd.get(q.end);
    if (!prev || (q.filed && (!prev.filed || q.filed >= prev.filed))) byEnd.set(q.end, q);
  }

  const annuals = allPoints
    .filter((p) => typeof p.val === "number" && p.start && p.end && isAnnualDuration(p))
    .sort((a, b) => a.end.localeCompare(b.end) || (b.filed || "").localeCompare(a.filed || ""));

  const seenAnnualEnds = new Set<string>();
  for (const annual of annuals) {
    if (seenAnnualEnds.has(annual.end)) continue;
    seenAnnualEnds.add(annual.end);
    if (byEnd.has(annual.end)) continue; // already have a quarter ending on FY end

    const inYear = [...byEnd.values()]
      .filter((q) => {
        if (!annual.start || q.end <= annual.start || q.end > annual.end || q.end === annual.end) {
          return false;
        }
        // Prefer points that start inside the fiscal year when start is present.
        if (q.start && q.start < annual.start) return false;
        return true;
      })
      .sort((a, b) => a.end.localeCompare(b.end));

    if (inYear.length !== 3) continue;
    const sum3 = inYear.reduce((s, p) => s + p.val, 0);
    const q4 = annual.val - sum3;
    // Per-share data is not strictly additive because the weighted share count can change.
    const avg = sum3 / 3;
    if (!additive && (!(q4 > 0) || q4 > avg * 3 || q4 < avg * 0.15)) continue;

    const lastQ = inYear[inYear.length - 1];
    const start =
      lastQ.end &&
      (() => {
        const d = new Date(lastQ.end + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      })();

    byEnd.set(annual.end, {
      end: annual.end,
      start: start || annual.start,
      val: q4,
      form: annual.form,
      filed: annual.filed,
      fy: annual.fy,
      fp: "Q4",
    });
  }

  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/**
 * Prefer CY*Qn frames, also keep duration-based quarters, then fill Q4
 * gaps from annual filings when XBRL omits the fourth quarter.
 */
function quarterlyPoints(points: FactPoint[], additive = false): FactPoint[] {
  const framed = points.filter((p) => p.frame && /^CY\d{4}Q[1-4]$/.test(p.frame));
  const duration = points.filter((p) => !p.frame && isQuarterDuration(p));

  // Merge by period end (framed wins over unframed duration duplicates).
  const byEnd = new Map<string, FactPoint>();
  for (const p of [...duration, ...framed]) {
    if (typeof p.val !== "number" || !p.end) continue;
    const prev = byEnd.get(p.end);
    if (
      !prev ||
      (p.frame && !prev.frame) ||
      (p.filed && prev.filed && p.filed > prev.filed) ||
      (!prev.filed && p.filed)
    ) {
      byEnd.set(p.end, p);
    }
  }

  return deriveMissingQuarters([...byEnd.values()], points, additive);
}

function latestInstant(points: FactPoint[]): FactPoint | null {
  const instants = points
    .filter((p) => typeof p.val === "number" && p.end && !p.start)
    .sort((a, b) => {
      const end = b.end.localeCompare(a.end);
      if (end) return end;
      return (b.filed || "").localeCompare(a.filed || "");
    });
  return instants[0] ?? null;
}

/**
 * Shares for market cap: prefer point-in-time shares outstanding; many filers
 * (e.g. META) only report weighted-average diluted shares in income statements.
 */
function latestSharesOutstanding(facts: CompanyFacts): number | null {
  const instantPts = [
    ...pickUnit(facts, ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"], ["shares"]),
    ...(facts.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? []),
  ];
  const instant = latestInstant(instantPts);
  if (instant && instant.val > 0) return instant.val;

  const weightedPts = pickBestUnit(
    facts,
    ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"],
    ["shares"],
  );
  const quarterly = quarterlyPoints(weightedPts);
  if (quarterly.length && quarterly[quarterly.length - 1].val > 0) {
    return quarterly[quarterly.length - 1].val;
  }

  const fallback = weightedPts
    .filter((p) => typeof p.val === "number" && p.val > 0 && p.end && isQuarterDuration(p))
    .sort((a, b) => b.end.localeCompare(a.end) || (b.filed || "").localeCompare(a.filed || ""));
  return fallback[0]?.val ?? null;
}

function toBillions(usd: number) {
  return usd / 1e9;
}

function seriesFromPoints(points: FactPoint[], scale: (n: number) => number, additive = false): QuarterlySeries {
  const q = quarterlyPoints(points, additive);
  return {
    ends: q.map((p) => p.end),
    values: q.map((p) => scale(p.val)),
  };
}

function consolidatedQuarters(facts: CompanyFacts, concepts: string[], currency: ReportingCurrency) {
  const quarters = new Map<string, number>();
  for (const concept of concepts) {
    for (const point of quarterlyPoints(pickUnit(facts, [concept], [currency]), true)) {
      if (!quarters.has(point.end)) quarters.set(point.end, point.val);
    }
  }
  return quarters;
}

function seriesFromQuarterMap(quarters: Map<string, number>): QuarterlySeries {
  const ends = [...quarters.keys()].sort();
  return { ends, values: ends.map((end) => toBillions(quarters.get(end)!)) };
}

function revenueSeries(facts: CompanyFacts, currency: ReportingCurrency): QuarterlySeries {
  const quarters = consolidatedQuarters(facts, [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues", "SalesRevenueNet", "Revenue",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
  ], currency);

  const serviceByFiling = new Map<string, number>();
  for (const point of pickUnit(facts, ["SalesRevenueServicesNet"], [currency])) {
    if (point.accn && isQuarterDuration(point)) {
      serviceByFiling.set(`${point.accn}:${point.start}:${point.end}`, point.val);
    }
  }
  const componentQuarters = new Map<string, FactPoint>();
  for (const point of pickUnit(facts, ["SalesRevenueGoodsNet"], [currency])) {
    if (!point.accn || !isQuarterDuration(point)) continue;
    const services = serviceByFiling.get(`${point.accn}:${point.start}:${point.end}`);
    if (services == null) continue;
    const existing = componentQuarters.get(point.end);
    if (!existing || (point.filed ?? "") >= (existing.filed ?? "")) {
      componentQuarters.set(point.end, { ...point, val: point.val + services });
    }
  }
  const comparable = [...componentQuarters.values()].filter(({ end }) => quarters.has(end));
  // Only fill gaps from components after confirming that they reconcile to
  // this issuer's consolidated total in comparable periods.
  if (comparable.length >= 2 && comparable.every(({ end, val }) => {
    const total = quarters.get(end)!;
    return Math.abs(val - total) <= Math.max(Math.abs(total) * 0.005, 1);
  })) {
    for (const { end, val } of componentQuarters.values()) {
      if (!quarters.has(end)) quarters.set(end, val);
    }
  }
  return seriesFromQuarterMap(quarters);
}

function cashFlowQuarters(points: FactPoint[]) {
  const quarters = new Map(points.filter(isQuarterDuration).sort(
    (a, b) => (a.filed ?? "").localeCompare(b.filed ?? ""),
  ).map((point) => [point.end, point]));
  const byFiscalStart = new Map<string, Map<string, FactPoint>>();
  for (const point of points) {
    const days = daysBetween(point.start, point.end);
    if (!point.start || days == null || days < 70 || days > 380 || !Number.isFinite(point.val)) continue;
    const ends = byFiscalStart.get(point.start) ?? new Map<string, FactPoint>();
    const saved = ends.get(point.end);
    if (!saved || (point.filed ?? "") >= (saved.filed ?? "")) ends.set(point.end, point);
    byFiscalStart.set(point.start, ends);
  }
  // Cash flow statements often give year-to-date figures. Difference adjacent
  // filings with the same fiscal-year start to recover each standalone quarter.
  for (const ends of byFiscalStart.values()) {
    const cumulative = [...ends.values()].sort((a, b) => a.end.localeCompare(b.end));
    for (let index = 1; index < cumulative.length; index++) {
      const previous = cumulative[index - 1];
      const current = cumulative[index];
      const gap = daysBetween(previous.end, current.end);
      if (gap == null || gap < 70 || gap > 110 || quarters.has(current.end)) continue;
      const start = new Date(previous.end + "T00:00:00Z");
      start.setUTCDate(start.getUTCDate() + 1);
      quarters.set(current.end, { ...current, start: start.toISOString().slice(0, 10), val: current.val - previous.val });
    }
  }
  return [...quarters.values()].sort((a, b) => a.end.localeCompare(b.end));
}

function splitAdjustedEps(facts: CompanyFacts, eps: FactPoint[]) {
  const tags = pickUnit(facts, ["StockholdersEquityNoteStockSplitConversionRatio1"], ["pure"]);
  const today = new Date().toISOString().slice(0, 10);
  const activeTags = tags.filter(({ end, val }) => end <= today && Number.isFinite(val) && val > 0 && val !== 1);
  const ratios = [...new Set(activeTags.map(({ val }) => val))];
  const weightedShares = pickUnit(facts, [
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "DilutedWeightedAverageNumberOfOrdinarySharesOutstanding",
  ], ["shares"]);
  const periodKey = (point: FactPoint) => `${point.start}:${point.end}`;
  const filingKey = (point: FactPoint) => point.accn ?? point.filed;
  const epsByFiling = new Map(eps.map((point) => [`${periodKey(point)}:${filingKey(point)}`, point.val]));
  const sharesByPeriod = new Map<string, FactPoint[]>();
  for (const point of weightedShares) {
    if (!point.start || !point.filed || point.filed > today || point.val <= 0 ||
        (!isQuarterDuration(point) && !isAnnualDuration(point))) continue;
    const key = periodKey(point);
    const period = sharesByPeriod.get(key) ?? [];
    period.push(point);
    sharesByPeriod.set(key, period);
  }

  type SplitEvidence = { ratio: number; before: string; after: string; period: string; tag?: number };
  const evidence: SplitEvidence[] = [];
  for (const [period, shares] of sharesByPeriod) {
    shares.sort((a, b) => a.filed!.localeCompare(b.filed!));
    for (let i = 1; i < shares.length; i++) {
      const previous = shares[i - 1];
      const current = shares[i];
      if (previous.filed === current.filed) continue;
      const observed = current.val / previous.val;
      const exact = (ratio: number) => Math.abs(observed / ratio - 1) <= 0.005;
      const tag = ratios.find((ratio) => exact(ratio) || exact(1 / ratio));
      const size = Math.round(Math.max(observed, 1 / observed));
      const inferred = observed > 1 ? size : 1 / size;
      const ratio = tag === undefined ? inferred : exact(tag) ? tag : 1 / tag;
      if (ratio === 1 || !exact(ratio)) continue;
      if (tag === undefined) {
        // Require matching EPS restatements to distinguish untagged splits from revised share counts.
        const oldEps = epsByFiling.get(`${period}:${filingKey(previous)}`);
        const newEps = epsByFiling.get(`${period}:${filingKey(current)}`);
        if (oldEps == null || newEps == null || Math.abs(newEps) < 0.05 ||
            Math.abs(oldEps / ratio - newEps) > Math.max(0.01, Math.abs(newEps) * 0.04)) continue;
      }
      evidence.push({ ratio, before: previous.filed!, after: current.filed!, period, tag });
    }
  }

  const transitions: (SplitEvidence & { periods: Set<string> })[] = [];
  for (const item of evidence.sort((a, b) => a.after.localeCompare(b.after))) {
    const match = transitions.find((event) =>
      event.ratio === item.ratio && item.before < event.after && event.before < item.after,
    );
    if (match) {
      if (item.before > match.before) match.before = item.before;
      match.periods.add(item.period);
    } else {
      transitions.push({ ...item, periods: new Set([item.period]) });
    }
  }
  const confirmed = transitions.filter((event) => event.tag !== undefined || event.periods.size >= 2);
  const events = confirmed
    .filter((event) => event.tag !== undefined || !confirmed.some((other) =>
      other.tag !== undefined && event.before < other.after && other.before < event.after,
    ))
    .map(({ after, ratio }) => ({ date: after, ratio }));

  for (const ratio of ratios) {
    if (confirmed.some((event) => event.tag === ratio)) continue;
    // A single date can establish the basis when the restated comparative is unavailable.
    const dates = new Set(activeTags.filter((point) => point.val === ratio).map((point) => point.end));
    if (dates.size === 1) events.push({ date: [...dates][0], ratio });
  }

  const points = eps.map((point) => {
    // A comparative value filed after the split is already on the new basis.
    // Normalize each submission before choosing a quarter or subtracting annual totals.
    const basisDate = point.filed ?? point.end;
    const factor = events.reduce((total, event) => basisDate < event.date ? total * event.ratio : total, 1);
    return factor === 1 ? point : { ...point, val: point.val / factor };
  });
  const basis = events.sort((a, b) => a.date.localeCompare(b.date)).map(({ ratio }) => ratio).join(",") || "1";
  return { points, basis };
}

/**
 * Build fundamentals from company facts. Does not call Marketstack —
 * pass live price later to compute market cap / EV / yield.
 */
export async function fetchEdgarFundamentals(
  ticker: string, refresh = false, filing?: { cik: number; accession: string },
): Promise<EdgarFundamentals | null> {
  const id = ticker.trim().toUpperCase();
  const cik = filing?.cik ?? await resolveCik(id);
  if (cik == null) return null;

  const facts = await loadCompanyFacts(cik, refresh);
  if (filing && !Object.values(facts.facts ?? {}).some((taxonomy) =>
    Object.values(taxonomy).some((concept) => Object.values(concept.units ?? {}).some(
      (points) => points.some((point) => point.accn === filing.accession),
    )),
  )) {
    throw new Error("The latest SEC filing is not yet indexed in Company Facts");
  }
  const usdRevenue = revenueSeries(facts, "USD");
  const eurRevenue = revenueSeries(facts, "EUR");
  const reportingCurrency = eurRevenue.ends.length >= 4 && eurRevenue.ends.length > usdRevenue.ends.length ? "EUR" : "USD";
  const revenue = reportingCurrency === "EUR" ? eurRevenue : usdRevenue;
  const money = [reportingCurrency];
  const perShare = [`${reportingCurrency}/shares`];
  const epsPts = pickBestUnit(facts, ["EarningsPerShareDiluted", "DilutedEarningsLossPerShare"], perShare);
  const cfoPts = pickBestUnit(facts, ["NetCashProvidedByUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities"], money);
  const capexConcepts = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"];
  const cashPts = pickUnit(facts, ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents"], money);
  const debtTotal = pickUnit(facts, ["LongTermDebt"], money);
  const debtLong = pickUnit(facts, ["LongTermDebtNoncurrent"], money);
  const debtCurrent = pickUnit(facts, ["LongTermDebtCurrent"], money);
  const shortBorrowings = pickUnit(facts, ["ShortTermBorrowings"], money);
  const sharePts = [
    ...pickUnit(facts, ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"], ["shares"]),
    ...(facts.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? []),
  ];
  const averageShares = seriesFromPoints(
    pickBestUnit(facts, ["WeightedAverageNumberOfSharesOutstandingBasic", "WeightedAverageNumberOfDilutedSharesOutstanding"], ["shares"]),
    toBillions,
  );
  const averageSharesByDate = new Map(averageShares.ends.map((date, index) => [date, averageShares.values[index]]));
  const equityPts = pickUnit(
    facts,
    ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    money,
  );
  const divPts = pickUnit(
    facts,
    ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
    perShare,
  );

  const operatingIncome = seriesFromQuarterMap(consolidatedQuarters(
    facts, ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"], reportingCurrency,
  ));
  const { points: adjustedEps, basis: epsSplitBasis } = splitAdjustedEps(facts, epsPts);
  const dilutedEps = seriesFromPoints(adjustedEps, (n) => n);

  // FCF ≈ CFO − |CapEx| on matching quarter ends
  const cfoQ = cashFlowQuarters(cfoPts);
  const capexByEnd = new Map(cashFlowQuarters(pickBestUnit(facts, capexConcepts, money))
    .map((p) => [p.end, Math.abs(p.val)]));
  for (const concept of capexConcepts) {
    for (const point of cashFlowQuarters(pickUnit(facts, [concept], money))) {
      if (!capexByEnd.has(point.end)) capexByEnd.set(point.end, Math.abs(point.val));
    }
  }
  const matchedCashFlow = cfoQ.filter((p) => capexByEnd.has(p.end));
  const freeCashFlow = {
    ends: matchedCashFlow.map(({ end }) => end),
    values: matchedCashFlow.map(({ end, val }) => toBillions(val - capexByEnd.get(end)!)),
  };

  const sharesVal = latestSharesOutstanding(facts);
  const cash = latestInstant(cashPts);
  const byDate = (points: FactPoint[]) => {
    const map = new Map<string, number>();
    for (const point of points.filter((point) => !point.start).sort((a, b) => (a.filed ?? "").localeCompare(b.filed ?? ""))) {
      map.set(point.end, toBillions(point.val));
    }
    return map;
  };
  const [total, long, current, short, cashByDate, sharesByDate] =
    [debtTotal, debtLong, debtCurrent, shortBorrowings, cashPts, sharePts].map(byDate);
  const balances: EdgarFundamentals["balances"] = {};
  for (const date of new Set([...revenue.ends, ...operatingIncome.ends])) {
    const longTerm = total.get(date) ??
      (long.has(date) || current.has(date) ? (long.get(date) ?? 0) + (current.get(date) ?? 0) : null);
    balances[date] = {
      debt: longTerm !== null || short.has(date) ? (longTerm ?? 0) + (short.get(date) ?? 0) : null,
      cash: cashByDate.get(date) ?? null,
      shares: sharesByDate.get(date) ?? averageSharesByDate.get(date) ?? null,
    };
  }

  const equity = latestInstant(equityPts);

  const divQ = quarterlyPoints(divPts);
  const lastFourDiv = divQ.slice(-4);
  const dividendPerShare =
    lastFourDiv.length >= 1
      ? lastFourDiv.reduce((sum, p) => sum + p.val, 0) *
        (lastFourDiv.length >= 4 ? 1 : 4 / Math.max(1, lastFourDiv.length))
      : null;

  const lastReportEnd =
    revenue.ends[revenue.ends.length - 1] ||
    operatingIncome.ends[operatingIncome.ends.length - 1] ||
    null;

  return {
    ticker: id,
    cik,
    entityName: facts.entityName || id,
    asOf: new Date().toISOString().slice(0, 10),
    filingAccession: filing?.accession,
    epsSplitBasisVersion: EPS_SPLIT_BASIS_VERSION,
    epsSplitBasis,
    reportingCurrency,
    revenue,
    operatingIncome,
    dilutedEps,
    freeCashFlow,
    tax: seriesFromPoints(pickBestUnit(facts, ["IncomeTaxExpenseBenefit", "IncomeTaxExpenseContinuingOperations"], money), toBillions, true),
    pretax: seriesFromPoints(pickBestUnit(facts, ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "ProfitLossBeforeTax"], money), toBillions, true),
    balances,
    sharesOutstandingBillions: sharesVal != null ? sharesVal / 1e9 : null,
    cashBillions: cash ? toBillions(cash.val) : null,
    debtBillions: lastReportEnd ? balances[lastReportEnd]?.debt ?? null : null,
    equityBillions: equity ? toBillions(equity.val) : null,
    dividendPerShare,
    lastReportEnd,
    source: "edgar",
  };
}
