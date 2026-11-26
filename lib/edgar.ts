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
  /** Quarterly revenue, USD billions */
  revenue: QuarterlySeries;
  /** Quarterly operating income, USD billions */
  operatingIncome: QuarterlySeries;
  /** Quarterly diluted EPS, USD/share */
  dilutedEps: QuarterlySeries;
  /** Quarterly free cash flow approx (CFO - capex), USD billions */
  freeCashFlow: QuarterlySeries;
  tax: QuarterlySeries;
  pretax: QuarterlySeries;
  balances: Record<string, { debt: number | null; cash: number | null; shares: number | null }>;
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
  source: "edgar";
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

export async function searchEdgarTickers(query: string) {
  const term = query.toUpperCase();
  const { names } = await getTickerDirectory();
  const matches = Object.entries(names ?? {})
    .filter(([ticker, name]) => ticker.startsWith(term) || name.toUpperCase().includes(term));
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
function deriveMissingQuarters(quarters: FactPoint[], allPoints: FactPoint[]): FactPoint[] {
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
    // Sanity: Q4 should be positive and in a plausible band vs the other quarters
    const avg = sum3 / 3;
    if (!(q4 > 0) || q4 > avg * 3 || q4 < avg * 0.15) continue;

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
function quarterlyPoints(points: FactPoint[]): FactPoint[] {
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

  return deriveMissingQuarters([...byEnd.values()], points);
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

function seriesFromPoints(points: FactPoint[], scale: (n: number) => number): QuarterlySeries {
  const q = quarterlyPoints(points);
  return {
    ends: q.map((p) => p.end),
    values: q.map((p) => scale(p.val)),
  };
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
  const revenuePts = pickBestUnit(
    facts,
    ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
    ["USD"],
  );
  const opPts = pickBestUnit(facts, ["OperatingIncomeLoss"], ["USD"]);
  const epsPts = pickBestUnit(facts, ["EarningsPerShareDiluted"], ["USD/shares"]);
  const cfoPts = pickBestUnit(facts, ["NetCashProvidedByUsedInOperatingActivities"], ["USD"]);
  const capexPts = pickBestUnit(
    facts,
    ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    ["USD"],
  );
  const cashPts = pickUnit(facts, ["CashAndCashEquivalentsAtCarryingValue"], ["USD"]);
  const debtTotal = pickUnit(facts, ["LongTermDebt"], ["USD"]);
  const debtLong = pickUnit(facts, ["LongTermDebtNoncurrent"], ["USD"]);
  const debtCurrent = pickUnit(facts, ["LongTermDebtCurrent"], ["USD"]);
  const shortBorrowings = pickUnit(facts, ["ShortTermBorrowings"], ["USD"]);
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
    ["USD"],
  );
  const divPts = pickUnit(
    facts,
    ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
    ["USD/shares"],
  );

  const revenue = seriesFromPoints(revenuePts, toBillions);
  const operatingIncome = seriesFromPoints(opPts, toBillions);
  const dilutedEps = seriesFromPoints(epsPts, (n) => n);

  // FCF ≈ CFO − |CapEx| on matching quarter ends
  const cfoQ = quarterlyPoints(cfoPts);
  const capexByEnd = new Map(quarterlyPoints(capexPts).map((p) => [p.end, Math.abs(p.val)]));
  const fcfPoints: FactPoint[] = cfoQ.filter((p) => capexByEnd.has(p.end)).map((p) => ({
    ...p,
    val: p.val - (capexByEnd.get(p.end) ?? 0),
  }));
  const freeCashFlow = seriesFromPoints(fcfPoints, toBillions);

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
    revenue,
    operatingIncome,
    dilutedEps,
    freeCashFlow,
    tax: seriesFromPoints(pickBestUnit(facts, ["IncomeTaxExpenseBenefit"], ["USD"]), toBillions),
    pretax: seriesFromPoints(pickBestUnit(facts, ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"], ["USD"]), toBillions),
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
