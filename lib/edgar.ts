/**
 * SEC EDGAR / data.sec.gov client.
 * Fair-access: identifying User-Agent, ~2–5 req/s, disk cache, no polling from the UI.
 * https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { displayCompanyName, isKnownFund, isSearchableTicker, normalizeTicker, searchMatchScore } from "@/lib/market";
import { isFiscalQuarterGap } from "@/lib/fiscalQuarter";

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
const REPORTING_CURRENCIES = ["USD", "EUR", "TWD", "CAD", "JPY", "CNY", "DKK", "CHF", "INR", "GBP", "BRL", "MXN", "KRW", "AUD", "SEK", "NOK"] as const;
export type ReportingCurrency = (typeof REPORTING_CURRENCIES)[number];

/** Minimum gap between SEC requests (ms). */
const MIN_GAP_MS = 250;

let nextRequestAt = 0;

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
  balances: Record<string, {
    debt: number | null; cash: number | null; shares: number | null; sti?: number | null;
    sharesEstimated?: boolean; reportedShares?: number;
  }>;
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
  /** True when EDGAR tags indicate a bank/insurer/broker (deposit interest or net interest revenue). */
  isFinancial?: boolean;
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

async function secFetch(url: string, allowMissing = false): Promise<Response> {
  const now = Date.now();
  const requestAt = Math.max(now, nextRequestAt);
  nextRequestAt = requestAt + MIN_GAP_MS;
  const wait = requestAt - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  const res = await fetch(url, {
    headers: {
      "User-Agent": userAgent(),
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok && !(allowMissing && res.status === 404)) {
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
  const id = normalizeTicker(ticker);
  if (isKnownFund(id)) return "fund";
  const directory = await getTickerDirectory();
  const secKey = id.replace(/\./g, "-");
  const name = directory.names?.[id] ?? directory.names?.[secKey] ?? "";
  if (/\b(?:ETFS?|EXCHANGE[- ]TRADED FUND)\b/i.test(name)) return "fund";
  if ((await loadFundSymbols()).has(id)) return "fund";
  return Object.hasOwn(directory.map, id) || Object.hasOwn(directory.map, secKey) ? "company" : null;
}

export async function searchEdgarTickers(query: string) {
  const term = query.toUpperCase();
  const normalizedTerm = normalizeTicker(term);
  if (!isSearchableTicker(normalizedTerm)) return [];
  const { names } = await getTickerDirectory();
  const seen = new Set<string>();
  const matches: { ticker: string; name: string; score: number }[] = [];
  for (const [rawTicker, name] of Object.entries(names ?? {})) {
    const ticker = normalizeTicker(rawTicker);
    if (!isSearchableTicker(ticker) || seen.has(ticker)) continue;
    const score = searchMatchScore(normalizedTerm, ticker, displayCompanyName(ticker, name));
    if (!Number.isFinite(score)) continue;
    seen.add(ticker);
    matches.push({ ticker, name, score });
  }
  if (/^[A-Z][A-Z0-9]{1,7}$/.test(normalizedTerm) && !seen.has(normalizedTerm)) {
    const funds = await loadFundSymbols().catch(() => null);
    if (funds?.has(normalizedTerm)) {
      matches.push({ ticker: normalizedTerm, name: "Fund", score: searchMatchScore(normalizedTerm, normalizedTerm, "Fund") });
    }
  }
  return matches
    .sort((a, b) => a.score - b.score || a.ticker.localeCompare(b.ticker))
    .slice(0, 8)
    .map(({ ticker, name }) => [ticker, name] as [string, string]);
}

export async function resolveCik(ticker: string): Promise<number | null> {
  const id = normalizeTicker(ticker);
  // ETFs / funds are not in company_tickers the same way for XBRL facts we need.
  if (isKnownFund(id)) return null;
  const map = await loadCikMap();
  return map[id] ?? map[id.replace(/\./g, "-")] ?? null;
}

export type CompanyFacts = {
  cik: number;
  entityName?: string;
  facts?: Record<string, Record<string, { units?: Record<string, FactPoint[]> }>>;
};

export async function loadCompanyFacts(cik: number, refresh = false): Promise<CompanyFacts> {
  const file = path.join(FACTS_DIR, `CIK${String(cik).padStart(10, "0")}.json`);
  const cached = readJsonFile<{ at: number; body: CompanyFacts }>(file);
  if (!refresh && cached && Date.now() - cached.at < FACTS_TTL_MS) return cached.body;

  const res = await secFetch(FACTS_URL(cik));
  const body = (await res.json()) as CompanyFacts;
  writeJsonFile(file, { at: Date.now(), body });
  return body;
}

export type FinancialFiling = { accession: string; date: string; document: string; filed?: string; amendment?: boolean };
const PERIODIC_FORMS = /^(10-K|10-Q|20-F|40-F)(\/A)?$/;
const DAILY_INDEX_ROOT = "https://www.sec.gov/Archives/edgar/daily-index/";
const dailyIndexQuarter = (date: string) => date.slice(0, 4) + "/QTR" + Math.ceil(Number(date.slice(5, 7)) / 3);

export async function publishedEarningsIndexDates(dates: string[]) {
  const quarters = [...new Set(dates.map(dailyIndexQuarter))];
  const published = await Promise.all(quarters.map(async (quarter) => {
    const response = await secFetch(DAILY_INDEX_ROOT + quarter + "/index.json");
    const { directory } = await response.json() as { directory: { item: { name: string }[] } };
    return new Set(directory.item.map(({ name }) => name));
  }));
  return dates.filter((date) => published[quarters.indexOf(dailyIndexQuarter(date))]
    .has(`master.${date.replaceAll("-", "")}.idx`));
}

/** The SEC publishes a daily index covering all filers, including their accession numbers. */
export async function listIndexedEarnings(date: string) {
  const url = `${DAILY_INDEX_ROOT}${dailyIndexQuarter(date)}/master.${date.replaceAll("-", "")}.idx`;
  const index = await secFetch(url, true);
  if (index.status === 404) return [];
  const body = await index.text();
  if (!/CIK\|Company Name\|Form Type\|Date Filed\|File ?Name/i.test(body)) {
    throw new Error("Invalid SEC daily filing index for " + date);
  }
  return body.split(/\r?\n/).flatMap((line) => {
    const [cik, , form, , file] = line.split("|");
    if (!PERIODIC_FORMS.test(form ?? "")) return [];
    const accession = file?.match(/(\d{10}-\d{2}-\d{6})\.txt\s*$/)?.[1];
    return accession && /^\d+$/.test(cik) ? [{ cik: Number(cik), accession }] : [];
  });
}

type SubmissionRows = {
  form: string[]; accessionNumber: string[]; reportDate: string[]; primaryDocument: string[];
  filingDate?: string[];
  isXBRL?: (number | boolean)[];
};

export async function listFinancialFilings(cik: number, since: string, includeAmendments = false, options: {
  includeForeignAnnual?: boolean; recentOnly?: boolean;
} = {}): Promise<FinancialFiling[]> {
  const root = "https://data.sec.gov/submissions/";
  const response = await secFetch(root + "CIK" + String(cik).padStart(10, "0") + ".json");
  const { filings } = await response.json() as {
    filings: { recent: SubmissionRows; files: { name: string; filingTo: string }[] };
  };
  const pages = [filings.recent];
  if (!options.recentOnly) {
    for (const file of filings.files.filter(({ filingTo }) => filingTo >= since)) {
      pages.push(await (await secFetch(root + file.name)).json() as SubmissionRows);
    }
  }
  return pages.flatMap((page) => page.form.flatMap((form, index) => {
    const date = page.reportDate[index];
    const amendment = form.endsWith("/A");
    const periodic = PERIODIC_FORMS.test(form) && (options.includeForeignAnnual || form.startsWith("10-")) &&
      (!amendment || (includeAmendments && page.isXBRL?.[index] !== 0 && page.isXBRL?.[index] !== false));
    return periodic && date >= since && page.primaryDocument[index]
      ? [{ accession: page.accessionNumber[index], date, document: page.primaryDocument[index],
        filed: page.filingDate?.[index], amendment }] : [];
  }));
}

/** META reports class-level quarter-end shares missing from Company Facts. */
export async function readMetaFilingBalances(filing: FinancialFiling) {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(filing.accession) || !/^[\w.-]+\.html?$/i.test(filing.document)) {
    throw new Error("Invalid META filing reference");
  }
  const url = "https://www.sec.gov/Archives/edgar/data/1326801/" + filing.accession.replaceAll("-", "") + "/" + filing.document;
  const html = await (await secFetch(url)).text();
  const contexts = new Map<string, string>();
  const consolidatedContexts = new Set<string>();
  for (const [, id, body] of html.matchAll(/<xbrli:context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/gi)) {
    if (!body.includes("<xbrli:instant>" + filing.date + "</xbrli:instant>")) continue;
    const members = [...body.matchAll(/<xbrldi:explicitMember\b[^>]*>([^<]+)</g)].map((match) => match[1]);
    if (/<xbrldi:typedMember\b/.test(body)) continue;
    if (members.length === 0) consolidatedContexts.add(id);
    if (members.length === 1) contexts.set(id, members[0]);
  }
  const values = new Map<string, Set<number>>();
  // Scan opening tags independently because SEC filings can nest identical numeric facts.
  for (const match of html.matchAll(/<ix:nonFraction\b[^>]*>/gi)) {
    const attributes = match[0];
    const context = attributes.match(/\bcontextRef="([^"]+)"/i)?.[1] ?? "";
    const concept = attributes.match(/\bname="([^"]+)"/i)?.[1];
    const member = concept === "us-gaap:CommonStockSharesOutstanding" ? contexts.get(context)
      : /^(?:fb|meta):NotionalCashPoolOverdraftBalance$/.test(concept ?? "") && consolidatedContexts.has(context) ? "overdraft" : null;
    if (!member) continue;
    const content = html.slice(match.index + attributes.length, match.index + attributes.length + 1000).match(/^(?:\s*<[^/][^>]*>)*\s*([\d,.]+)\s*</);
    const raw = Number(content?.[1].replaceAll(",", ""));
    const value = raw * 10 ** Number(attributes.match(/\bscale="(-?\d+)"/i)?.[1] ?? 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    const candidates = values.get(member) ?? new Set<number>();
    candidates.add(value);
    values.set(member, candidates);
  }
  function unambiguous(member: string) {
    const candidates = [...(values.get(member) ?? [])];
    return candidates.length === 1 ? candidates[0] : null;
  }
  const a = unambiguous("us-gaap:CommonClassAMember");
  const b = unambiguous("us-gaap:CommonClassBMember");
  const shares = a != null && b != null ? a + b : unambiguous("us-gaap:CommonStockMember");
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#(?:32|160|x0*(?:20|a0));|&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  }).format(new Date(filing.date + "T00:00:00Z"));
  const unusedFacility = new RegExp("As of " + dateLabel + " *, no amounts? had been drawn down", "i").test(text);
  const explicitlyDebtFree = new RegExp("As of " + dateLabel + " *, we had no (?:outstanding debt|debt outstanding)\\b", "i").test(text);
  const overdraft = unambiguous("overdraft");
  // Meta’s filings identify the revolver as undrawn before the bond issuance.
  // When the pool existed, require its actual balance before assigning debt.
  const debt = explicitlyDebtFree ? 0
    : filing.date < "2018-01-01" && unusedFacility ? 0
    : filing.date < "2022-09-30" && unusedFacility && overdraft != null ? toBillions(overdraft) : null;
  return { shares: shares == null ? null : toBillions(shares), debt, url };
}

export async function readMetaCashPoolDebt(reported2019Debt: number) {
  const facts = await loadCompanyFacts(1326801);
  const movements = pickUnit(facts, ["ProceedsFromRepaymentsOfBankOverdrafts"], ["USD"]);
  // The filings date the start of the cash pool to 2018. Reconstruct its first
  // two years only if the cash movements reconcile to the reported 2019 balance.
  const balances = new Map<string, number>();
  let opening = 0;
  for (const year of ["2018", "2019"]) {
    for (const monthDay of ["03-31", "06-30", "09-30", "12-31"]) {
      const date = year + "-" + monthDay;
      const candidates = new Set(movements.filter(({ start, end }) => start === year + "-01-01" && end === date)
        .map(({ val }) => val));
      const value = [...candidates][0];
      if (candidates.size !== 1 || !Number.isFinite(value) || opening + value < 0) return new Map<string, number>();
      balances.set(date, toBillions(opening + value));
      if (monthDay === "12-31") opening += value;
    }
  }
  return Math.abs(toBillions(opening) - reported2019Debt) < 0.000001 ? balances : new Map<string, number>();
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
  return d !== null && isFiscalQuarterGap(d + 1);
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
function deriveMissingQuarters(quarters: FactPoint[], allPoints: FactPoint[], mode: boolean | "average"): FactPoint[] {
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
    const lastQ = inYear[inYear.length - 1];
    let q4 = annual.val - sum3;
    if (mode === "average") {
      const boundaries = [annual.start!, ...inYear.map(({ end }) => end), annual.end];
      const durations = boundaries.slice(1).map((end, i) => (daysBetween(boundaries[i], end) ?? 0) + (i === 0 ? 1 : 0));
      if (!durations.every(isFiscalQuarterGap)) continue;
      q4 = (annual.val * durations.reduce((sum, days) => sum + days, 0)
        - inYear.reduce((sum, point, i) => sum + point.val * durations[i], 0)) / durations[3];
    }
    // Per-share data is not strictly additive because the weighted share count can change.
    const avg = sum3 / 3;
    if (mode !== true && (!(q4 > 0) || q4 > avg * 3 || q4 < avg * 0.15)) continue;

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
function quarterlyPoints(points: FactPoint[], mode: boolean | "average" = false): FactPoint[] {
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

  return deriveMissingQuarters([...byEnd.values()], points, mode);
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

function seriesFromPoints(points: FactPoint[], scale: (n: number) => number, mode: boolean | "average" = false): QuarterlySeries {
  const q = quarterlyPoints(points, mode);
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

function revenueSeries(facts: CompanyFacts, currency: ReportingCurrency, preferTotalRevenue: boolean): QuarterlySeries {
  const concepts = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues", "SalesRevenueNet", "Revenue",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "RevenuesNetOfInterestExpense",
    "InterestAndDividendIncomeOperating",
    "RegulatedAndUnregulatedOperatingRevenue",
    "ElectricUtilityRevenue",
    "OilAndGasRevenue",
    "InsuranceServicesRevenue",
    "RealEstateRevenueNet",
    "HealthCareOrganizationRevenue",
    "FinancialServicesRevenue",
  ];
  // These issuers separately tag sales from customer contracts inside total revenue.
  if (preferTotalRevenue) concepts.unshift("Revenues");
  const quarters = consolidatedQuarters(facts, concepts, currency);

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
      if (gap == null || !isFiscalQuarterGap(gap) || quarters.has(current.end)) continue;
      const start = new Date(previous.end + "T00:00:00Z");
      start.setUTCDate(start.getUTCDate() + 1);
      quarters.set(current.end, { ...current, start: start.toISOString().slice(0, 10), val: current.val - previous.val });
    }
  }
  return [...quarters.values()].sort((a, b) => a.end.localeCompare(b.end));
}

export function splitAdjustedEps(facts: CompanyFacts, eps: FactPoint[]) {
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

  const factorAtFiling = (basisDate: string) => events.reduce((total, event) =>
    basisDate < event.date ? total * event.ratio : total, 1);
  const points = eps.map((point) => {
    // A comparative value filed after the split is already on the new basis.
    // Normalize each submission before choosing a quarter or subtracting annual totals.
    const basisDate = point.filed ?? point.end;
    const factor = factorAtFiling(basisDate);
    return factor === 1 ? point : { ...point, val: point.val / factor };
  });
  const basis = events.sort((a, b) => a.date.localeCompare(b.date)).map(({ ratio }) => ratio).join(",") || "1";
  return { points, basis, factorAtFiling };
}

/**
 * Build fundamentals from company facts. Does not call Marketstack —
 * pass live price later to compute market cap / EV / yield.
 */
export async function fetchEdgarFundamentals(
  ticker: string, refresh = false, filing?: { cik: number; accession?: string },
): Promise<EdgarFundamentals | null> {
  const id = ticker.trim().toUpperCase();
  const cik = filing?.cik ?? await resolveCik(id);
  if (cik == null) return null;

  const facts = await loadCompanyFacts(cik, refresh);
  if (filing?.accession && !Object.values(facts.facts ?? {}).some((taxonomy) =>
    Object.values(taxonomy).some((concept) => Object.values(concept.units ?? {}).some(
      (points) => points.some((point) => point.accn === filing.accession),
    )),
  )) {
    throw new Error("The latest SEC filing is not yet indexed in Company Facts");
  }
  const preferTotalRevenue = id === "CP" || id === "ENB" || id === "BAM";
  let reportingCurrency: ReportingCurrency = "USD";
  let revenue = revenueSeries(facts, reportingCurrency, preferTotalRevenue);
  for (const currency of REPORTING_CURRENCIES.slice(1)) {
    const candidate = revenueSeries(facts, currency, preferTotalRevenue);
    if (candidate.ends.length >= 4 && candidate.ends.length > revenue.ends.length) {
      reportingCurrency = currency;
      revenue = candidate;
    }
  }
  const money = [reportingCurrency];
  const perShare = [`${reportingCurrency}/shares`];
  const epsPts = pickBestUnit(facts, ["EarningsPerShareDiluted", "DilutedEarningsLossPerShare"], perShare);
  const epsKeys = new Set(epsPts.map((point) => `${point.accn}:${point.start}:${point.end}`));
  const comparableEpsTags = ["EarningsPerShareBasicAndDiluted", "NetIncomeLossNetOfTaxPerOutstandingLimitedPartnershipUnitDiluted"];
  // Airbnb tags its consolidated diluted EPS under the continuing-operations concept.
  if (id === "ABNB") comparableEpsTags.push("IncomeLossFromContinuingOperationsPerDilutedShare");
  for (const tag of comparableEpsTags) {
    for (const point of pickUnit(facts, [tag], perShare)) {
      const key = `${point.accn}:${point.start}:${point.end}`;
      if (epsKeys.has(key)) continue;
      epsPts.push(point);
      epsKeys.add(key);
    }
  }
  const cfoPts = pickBestUnit(facts, ["NetCashProvidedByUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities"], money);
  const capexConcepts = [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsToAcquirePropertyAndEquipment",
    "PaymentsToAcquireAndDevelopRealEstate",
    "PaymentsToAcquireOilAndGasPropertyAndEquipment",
  ];
  const cashPts = pickUnit(facts, ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents"], money);
  const cashCombinedPts = pickUnit(facts, ["CashCashEquivalentsAndShortTermInvestments"], money);
  const cashFallbackPts = pickUnit(facts, [
    "CashAndDueFromBanks",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations",
  ], money);
  const debtTotal = pickUnit(facts, [
    "LongTermDebt",
    "DebtLongtermAndShorttermCombinedAmount",
  ], money);
  const debtLong = pickUnit(facts, [
    "LongTermDebtNoncurrent",
    "SeniorLongTermNotes",
    "SeniorNotes",
    "UnsecuredLongTermDebt",
    "UnsecuredDebt",
    "ConvertibleLongTermNotesPayable",
    "ConvertibleDebtNoncurrent",
    "OtherLongTermDebtNoncurrent",
  ], money);
  const debtCurrent = pickUnit(facts, ["LongTermDebtCurrent"], money);
  const shortBorrowings = pickUnit(facts, ["ShortTermBorrowings", "ShortTermDebt", "NotesPayableCurrent"], money);
  const sharePts = [
    ...pickUnit(facts, ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"], ["shares"]),
    ...(facts.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? []),
  ];
  const averageShares = seriesFromPoints(
    pickBestUnit(facts, ["WeightedAverageNumberOfSharesOutstandingBasic", "WeightedAverageNumberOfDilutedSharesOutstanding"], ["shares"]),
    toBillions,
    "average",
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

  const pretaxMap = consolidatedQuarters(facts, [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "ProfitLossBeforeTax",
  ], reportingCurrency);
  const operatingMap = consolidatedQuarters(
    facts, ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"], reportingCurrency,
  );
  // Many US-GAAP filers (e.g. IBM, LLY, NKE, PFE, CVX, XOM, ADP, BRK.B, and financials) do not
  // tag OperatingIncomeLoss (or stopped tagging it in recent years). Fall back to EBIT = pretax + interest
  // (or pretax for banks) for missing quarters when pretax has better coverage.
  const latestOpEnd = [...operatingMap.keys()].sort().at(-1) ?? "";
  const latestPreEnd = [...pretaxMap.keys()].sort().at(-1) ?? "";
  const isFinancial =
    pickUnit(facts, ["InterestExpenseDeposits", "RevenuesNetOfInterestExpense"], money).length > 0;
  if (
    pretaxMap.size >= 4 &&
    (operatingMap.size < 4 || operatingMap.size < pretaxMap.size * 0.75 || latestPreEnd > latestOpEnd)
  ) {
    const interestMap = isFinancial
      ? new Map<string, number>()
      : consolidatedQuarters(
          facts,
          ["InterestExpense", "InterestExpenseDebt", "InterestAndDebtExpense"],
          reportingCurrency,
        );
    for (const [end, pre] of pretaxMap) {
      if (!operatingMap.has(end)) {
        const interest = interestMap.get(end);
        operatingMap.set(end, interest != null && Number.isFinite(interest) && interest > 0 ? pre + interest : pre);
      }
    }
  }
  const operatingIncome = seriesFromQuarterMap(operatingMap);
  const { points: adjustedEps, basis: epsSplitBasis } = splitAdjustedEps(facts, epsPts);
  const dilutedEps = seriesFromPoints(adjustedEps, (n) => n);

  // FCF ≈ CFO − |CapEx|. Match exact quarter ends first, then nearest capex within ~45 days.
  // Utilities like NEE often omit PPE payment tags; fall back to investing outflows.
  const cfoQ = cashFlowQuarters(cfoPts);
  const capexByEnd = new Map(cashFlowQuarters(pickBestUnit(facts, capexConcepts, money))
    .map((p) => [p.end, Math.abs(p.val)]));
  for (const concept of capexConcepts) {
    for (const point of cashFlowQuarters(pickUnit(facts, [concept], money))) {
      if (!capexByEnd.has(point.end)) capexByEnd.set(point.end, Math.abs(point.val));
    }
  }
  const investingByEnd = new Map(cashFlowQuarters(
    pickUnit(facts, ["NetCashProvidedByUsedInInvestingActivities"], money),
  ).map((p) => [p.end, p.val]));
  const capexEnds = [...capexByEnd.keys()].sort();
  const nearestCapex = (end: string) => {
    const exact = capexByEnd.get(end);
    if (exact != null) return exact;
    const target = Date.parse(end);
    let best: { diff: number; val: number } | null = null;
    for (const date of capexEnds) {
      const diff = Math.abs(Date.parse(date) - target);
      if (diff <= 45 * 86_400_000 && (!best || diff < best.diff)) best = { diff, val: capexByEnd.get(date)! };
    }
    return best?.val;
  };
  const freeCashFlowEnds: string[] = [];
  const freeCashFlowValues: number[] = [];
  for (const { end, val } of cfoQ) {
    let capex = nearestCapex(end);
    if (capex == null) {
      const investing = investingByEnd.get(end);
      if (investing != null && investing < 0) capex = -investing;
    }
    // Financials often omit PPE capex tags; treat missing capex as $0 so FCF ≈ CFO.
    if (capex == null && !isFinancial) continue;
    freeCashFlowEnds.push(end);
    freeCashFlowValues.push(toBillions(val - (capex ?? 0)));
  }
  const freeCashFlow = { ends: freeCashFlowEnds, values: freeCashFlowValues };

  const sharesVal = latestSharesOutstanding(facts);
  const cash = latestInstant(cashPts) ?? latestInstant(cashCombinedPts) ?? latestInstant(cashFallbackPts);
  const byDate = (points: FactPoint[]) => {
    const map = new Map<string, number>();
    for (const point of points.filter((point) => !point.start).sort((a, b) => (a.filed ?? "").localeCompare(b.filed ?? ""))) {
      map.set(point.end, toBillions(point.val));
    }
    return map;
  };
  const [total, long, current, short, cashByDate, cashCombinedByDate, cashFallbackByDate, sharesByDate] =
    [debtTotal, debtLong, debtCurrent, shortBorrowings, cashPts, cashCombinedPts, cashFallbackPts, sharePts].map(byDate);
  const alternativeLong = byDate(pickUnit(facts, [
    "LongTermDebtAndCapitalLeaseObligations",
    "LongTermDebtAndFinanceLeaseObligations",
  ], money));
  const alternativeCurrent = byDate(pickUnit(facts, ["DebtCurrent"], money));
  const commercialPaper = byDate(pickUnit(facts, ["CommercialPaper"], money));
  // Total debt including finance/capital leases (used as primary for MU and fallback for others).
  const totalWithLeases = byDate(pickUnit(facts, ["DebtAndCapitalLeaseObligations"], money));
  const investments = [
    "ShortTermInvestments", "MarketableSecuritiesCurrent", "MarketableSecurities",
    "DebtSecuritiesAvailableForSaleExcludingAccruedInterestCurrent",
    "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent", "DebtSecuritiesCurrent",
  ].map((tag) => byDate(pickUnit(facts, [tag], money)));
  const coverShares = [...sharesByDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const nearestCoverShares = (date: string) => {
    const exact = sharesByDate.get(date);
    if (exact != null) return exact;
    const target = Date.parse(date);
    let best: { diff: number; val: number } | null = null;
    for (const [d, val] of coverShares) {
      const diff = Math.abs(Date.parse(d) - target);
      if (diff <= 45 * 86_400_000 && (!best || diff < best.diff)) best = { diff, val };
    }
    return best?.val;
  };
  const balances: EdgarFundamentals["balances"] = {};
  for (const date of new Set([...revenue.ends, ...operatingIncome.ends])) {
    const noncurrent = long.get(date) ?? alternativeLong.get(date);
    const currentDebt = current.get(date) ?? alternativeCurrent.get(date);
    const shortDebt = alternativeCurrent.has(date) && !current.has(date)
      ? undefined : short.get(date) ?? (total.has(date) ? undefined : commercialPaper.get(date));
    const longTerm = total.get(date) ??
      (noncurrent != null || currentDebt != null ? (noncurrent ?? 0) + (currentDebt ?? 0) : null);
    const combinedDebt = longTerm !== null || shortDebt != null ? (longTerm ?? 0) + (shortDebt ?? 0) : null;
    const debt = id === "MU"
      ? (totalWithLeases.get(date) ?? combinedDebt)
      : (combinedDebt ?? totalWithLeases.get(date) ?? null);
    const rawCash = cashByDate.get(date);
    const combinedCash = rawCash == null ? cashCombinedByDate.get(date) : undefined;
    const cashVal = rawCash ?? combinedCash ?? cashFallbackByDate.get(date) ?? null;
    // Do not subtract STI separately if cash came from CashCashEquivalentsAndShortTermInvestments.
    const sti = combinedCash != null
      ? undefined
      : investments.map((series) => series.get(date)).find((value) => value != null);
    const coverShareVal = nearestCoverShares(date);
    const shareVal = coverShareVal ?? averageSharesByDate.get(date) ?? null;
    balances[date] = {
      debt,
      cash: cashVal,
      shares: shareVal,
      ...(shareVal != null ? { sharesEstimated: coverShareVal == null } : {}),
      ...(sti != null ? { sti } : {}),
    };
  }
  if (id === "META" && filing?.accession) {
    const recent = await listFinancialFilings(cik, operatingIncome.ends.at(-1) ?? "9999").catch(() => []);
    const report = recent.find(({ accession }) => accession === filing.accession);
    if (report && balances[report.date]) {
      const verified = await readMetaFilingBalances(report).catch(() => null);
      if (verified?.shares != null) {
        balances[report.date].reportedShares = verified.shares;
      }
      if (verified?.debt != null && balances[report.date].debt == null) balances[report.date].debt = verified.debt;
    }
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
    isFinancial,
    revenue,
    operatingIncome,
    dilutedEps,
    freeCashFlow,
    tax: seriesFromPoints(pickBestUnit(facts, ["IncomeTaxExpenseBenefit", "IncomeTaxExpenseContinuingOperations"], money), toBillions, true),
    pretax: seriesFromQuarterMap(pretaxMap),
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
