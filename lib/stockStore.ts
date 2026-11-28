import type { EdgarFundamentals, QuarterlySeries, ReportingCurrency } from "@/lib/edgar";
import { displayCompanyName, isCanadianFund, isKnownFund } from "@/lib/market";
import { marketstackSymbol, type StockHistory, type StockQuote } from "@/lib/marketstack";
import { canReviewValuation, prepareValuationReview } from "@/lib/valuationReview";

export type ValuationPoint = {
  quarter: string; close: number; ev: number; nopat: number; ev_nopat: number;
  sharesEstimated?: boolean; earningsRelease?: boolean;
  debtEstimate?: { debt: number; method: "assumed-zero" | "carried-forward"; reportedAsOf?: string };
};
export type CurrentValuation = ValuationPoint & { priceAsOf: string };
type StoredValuation = { points: ValuationPoint[]; current: CurrentValuation | null };
export type AdjustedEpsRecord = {
  ticker: string;
  source_accession: string;
  filed_on: string;
  source_quarter: string;
  ttm_quarter: string;
  reported_quarter_eps: number | null;
  adjusted_quarter_eps: number | null;
  reported_ttm_eps: number | null;
  adjusted_ttm_eps: number | null;
  inputs: {
    periodStart: string; dilutedShares: number | null; equityGains: number | null;
    taxRate: number; taxRateMethod: "effective" | "fallback"; sharesEstimated: boolean;
    adjustmentSource?: string; annual: boolean;
  } | null;
};
type TickerIdentity = {
  ticker: string;
  name?: string | null;
  cik: number | null;
};
type StoredTicker = TickerIdentity & {
  edgar_snapshot: EdgarFundamentals | null;
  edgar_fetched_at: string | null;
  prices_fetched_at: string | null;
};

export function hasStockStore() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function rest<T>(
  table: string, query: Record<string, string>, rows?: object | object[],
  method = rows ? "POST" : "GET", prefer = "resolution=merge-duplicates,return=minimal",
): Promise<T> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Supabase credentials are missing");
  const url = new URL("/rest/v1/" + table, base);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
      "User-Agent": "Intrisal-server/1.0",
      ...(rows ? { "Content-Type": "application/json", Prefer: prefer } : {}),
    },
    body: rows ? JSON.stringify(rows) : undefined,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Supabase ${table} HTTP ${response.status}`);
  return response.status === 204 || (rows && prefer.includes("return=minimal")) ? undefined as T : response.json();
}

async function upsert(table: string, key: string, rows: object[]) {
  for (let offset = 0; offset < rows.length; offset += 500) {
    await rest(table, { on_conflict: key }, rows.slice(offset, offset + 500));
  }
}

export function readAdjustedEps(ticker: string) {
  return rest<Pick<AdjustedEpsRecord, "source_accession" | "filed_on" | "ttm_quarter" | "reported_ttm_eps" | "adjusted_ttm_eps">[]>(
    "adjusted_eps_history", {
      select: "source_accession,filed_on,ttm_quarter,reported_ttm_eps,adjusted_ttm_eps",
      ticker: "eq." + ticker, order: "filed_on.asc,source_quarter.asc,source_accession.asc",
    },
  );
}

export async function insertAdjustedEps(rows: AdjustedEpsRecord[]) {
  if (!rows.length) return 0;
  const inserted = await rest<{ source_accession: string }[]>("adjusted_eps_history",
    { on_conflict: "ticker,source_accession", select: "source_accession" }, rows, "POST",
    "resolution=ignore-duplicates,return=representation");
  return inserted.length;
}

export async function readAdjustedEpsIssuers() {
  const rows: { ticker: string; cik: number }[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await rest<typeof rows>("tickers", {
      select: "ticker,cik,adjusted_eps_history!inner()",
      cik: "not.is.null", order: "ticker.asc", offset: String(offset), limit: "500",
    });
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export async function readAdjustedEpsAccessionsSince(since: string) {
  const seen = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const page = await rest<{ ticker: string; source_accession: string }[]>("adjusted_eps_history", {
      select: "ticker,source_accession", filed_on: "gte." + since,
      order: "ticker.asc,source_accession.asc", offset: String(offset), limit: "500",
    });
    for (const row of page) seen.add(row.ticker + ":" + row.source_accession);
    if (page.length < 500) return seen;
  }
}

export async function readTicker(ticker: string) {
  const [row] = await rest<StoredTicker[]>("tickers", {
    select: "ticker,name,cik,edgar_snapshot,edgar_fetched_at,prices_fetched_at",
    ticker: "eq." + ticker,
    limit: "1",
  });
  return row;
}

export function isStoredFund(row: TickerIdentity | undefined) {
  // ETF imports record a listing name and leave CIK empty. Price-only equity/ADR
  // inserts from Yahoo history loads look the same, so require an explicit fund cue
  // (or a known fund ticker) instead of treating every named cik-null row as a fund.
  if (row?.cik !== null || !row?.name?.trim()) return false;
  if (isKnownFund(row.ticker) || isCanadianFund(row.ticker)) return true;
  return /\b(?:ETFS?|EXCHANGE[- ]TRADED FUND|TRUST|FUND|SHARES|MINISHARES|ULTRAPRO|ULTRASHORT)\b/i.test(row.name)
    || /^(?:ProShares|iShares|SPDR|Vanguard|Direxion|Global X|ARK|WisdomTree|Avantis|PIMCO|Invesco|VanEck|Schwab|Fidelity)\b/i.test(row.name);
}

export async function hasStoredFund(ticker: string) {
  const [row] = await rest<TickerIdentity[]>("tickers", {
    select: "ticker,name,cik", ticker: "eq." + ticker, limit: "1",
  });
  return isStoredFund(row);
}

export async function readStoredTickerDirectory(): Promise<[string, string][]> {
  if (!hasStockStore()) return [];
  const directory: [string, string][] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const rows = await rest<{ ticker: string; name: string }[]>("tickers", {
      select: "ticker,name", name: "not.is.null", ticker: "not.is.null",
      order: "ticker.asc", limit: String(pageSize), offset: String(offset),
    });
    for (const { ticker, name } of rows) if (name.trim()) directory.push([ticker, name]);
    if (rows.length < pageSize) break;
  }
  return directory;
}

export async function readQuarterlyFundamentals(ticker: StoredTicker, currency: ReportingCurrency): Promise<EdgarFundamentals | null> {
  if (ticker.cik == null) return null;
  const rows = await rest<{
    quarter: string; reporting_currency: ReportingCurrency;
    revenue: number | null; operating_income: number | null; diluted_eps: number | null;
    free_cash_flow: number | null; tax: number | null; pretax: number | null;
    cash: number | null; debt: number | null; shares: number | null; sti: number | null;
  }[]>("fundamentals_quarterly", {
    select: "quarter,reporting_currency,revenue,operating_income,diluted_eps,free_cash_flow,tax,pretax,cash,debt,shares,sti",
    ticker: "eq." + ticker.ticker, reporting_currency: "eq." + currency, order: "quarter.asc",
  });
  const last = rows.at(-1);
  if (!last) return null;
  const series = (field: "revenue" | "operating_income" | "diluted_eps" | "free_cash_flow" | "tax" | "pretax") => {
    const points: QuarterlySeries = { ends: [], values: [] };
    for (const row of rows) {
      const amount = row[field];
      if (amount == null || !Number.isFinite(amount)) continue;
      points.ends.push(row.quarter);
      points.values.push(amount);
    }
    return points;
  };
  return {
    ticker: ticker.ticker, cik: ticker.cik, entityName: ticker.name ?? ticker.ticker,
    asOf: ticker.edgar_fetched_at ?? last.quarter, reportingCurrency: last.reporting_currency,
    // The exhibit backfill verifies its split-adjusted EPS before writing quarterly rows.
    epsSplitBasisVersion: 5,
    revenue: series("revenue"), operatingIncome: series("operating_income"), dilutedEps: series("diluted_eps"),
    freeCashFlow: series("free_cash_flow"), tax: series("tax"), pretax: series("pretax"),
    balances: Object.fromEntries(rows.map(({ quarter, cash, debt, shares, sti }) => [quarter, { cash, debt, shares, sti }])),
    sharesOutstandingBillions: null, cashBillions: last.cash, debtBillions: last.debt,
    equityBillions: null, dividendPerShare: null, lastReportEnd: last.quarter, source: "edgar-6k",
  };
}

export async function trackedTickers(limit = 50) {
  const rows = await rest<{ ticker: string }[]>("tickers", {
    select: "ticker",
    ticker: "neq.TEST",
    or: "(cik.not.is.null,name.is.null)",
    order: "edgar_fetched_at.asc.nullsfirst",
    limit: String(limit),
  });
  return rows.map(({ ticker }) => ticker);
}

export async function trackedPriceTickers() {
  const rows: { ticker: string; prices_fetched_at: string | null }[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await rest<{ ticker: string; prices_fetched_at: string | null }[]>("tickers", {
      select: "ticker,prices_fetched_at",
      ticker: "neq.TEST",
      order: "prices_fetched_at.asc.nullsfirst",
      limit: "500",
      offset: String(offset),
    });
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows;
}

export async function saveBatchPrices(
  bars: { ticker: string; date: string; close: number; adjusted_close: number }[],
  touchedTickers: string[],
  fetchedAt: string,
) {
  if (bars.length) {
    await upsert("price_history", "ticker,date", bars);
  }
  if (touchedTickers.length) {
    await upsert(
      "tickers",
      "ticker",
      touchedTickers.map((ticker) => ({ ticker, prices_fetched_at: fetchedAt })),
    );
  }
}

type PriceRow = { date: string; close: number; adjusted_close: number | null };

function priceRows(ticker: string, limit: number, before?: string) {
  return rest<PriceRow[]>("price_history", {
    ticker: "eq." + ticker, select: "date,close,adjusted_close", order: "date.desc", limit: String(limit),
    ...(before ? { date: "lt." + before } : {}),
  });
}

export async function readLatestPriceDate(ticker: string) {
  return (await priceRows(ticker, 1))[0]?.date;
}

export async function readTickerNames(tickers: string[]): Promise<Record<string, string>> {
  if (!tickers.length) return {};
  const rows = await rest<{ ticker: string; name: string | null }[]>("tickers", {
    select: "ticker,name",
    ticker: "in.(" + tickers.join(",") + ")",
  });
  return Object.fromEntries(rows.flatMap(({ ticker, name }) => (name ? [[ticker, displayCompanyName(ticker, name)]] : [])));
}

export async function readStoredQuotes(tickers: string[]) {
  const names = await readTickerNames(tickers).catch(() => ({} as Record<string, string>));
  const entries = await Promise.all(tickers.map(async (ticker) => {
    const [last, previous] = await priceRows(ticker, 2);
    if (!last) return null;
    return [ticker, {
      ticker,
      ...(names[ticker] ? { name: names[ticker] } : {}),
      price: last.close,
      change: (last.close / (previous?.close ?? last.close) - 1) * 100,
      date: last.date,
      source: "marketstack",
    } satisfies StockQuote] as const;
  }));
  return { quotes: Object.fromEntries(entries.filter((entry) => entry !== null)), names };
}

export async function claimPriceRefresh(ticker: string, now: Date) {
  await rest("tickers", { on_conflict: "ticker" }, [{ ticker }], "POST", "resolution=ignore-duplicates,return=minimal");
  const today = now.toISOString().slice(0, 10) + "T00:00:00Z";
  const rows = await rest<{ ticker: string }[]>("tickers", {
    ticker: "eq." + ticker, or: `(prices_fetched_at.is.null,prices_fetched_at.lt.${today})`, select: "ticker",
  }, { prices_fetched_at: now.toISOString() }, "PATCH", "return=representation");
  return rows.length > 0;
}

export async function readPrices(ticker: string, maxRows = 3000): Promise<StockHistory | null> {
  const rows: PriceRow[] = [];
  while (rows.length < maxRows) {
    const limit = Math.min(1000, maxRows - rows.length);
    const page = await priceRows(ticker, limit, rows.at(-1)?.date);
    rows.push(...page);
    if (page.length < limit) break;
  }
  if (!rows.length) return null;
  const last = rows[0];
  const previous = rows[1]?.close ?? last.close;
  const year = rows.slice(0, 252).map(({ close, adjusted_close }) => adjusted_close ?? close);
  rows.reverse();
  return {
    ticker, symbol: marketstackSymbol(ticker), dates: rows.map(({ date }) => date),
    closes: rows.map(({ close, adjusted_close }) => adjusted_close ?? close),
    rawCloses: rows.map(({ close }) => close),
    price: last.close, change: (last.close / previous - 1) * 100,
    high52: Math.max(...year), low52: Math.min(...year), asOf: last.date, source: "marketstack",
  };
}

export async function savePrices(ticker: string, history: StockHistory) {
  const rows = new Map<string, { ticker: string; date: string; close: number; adjusted_close: number }>();
  for (const [index, date] of history.dates.entries()) {
    const close = history.rawCloses?.[index];
    if (close != null) rows.set(date, { ticker, date, close, adjusted_close: history.closes[index] });
  }
  if (!rows.size) return;
  await upsert("price_history", "ticker,date", [...rows.values()]);
}

export function markFilingsChecked(ticker: string) {
  return upsert("tickers", "ticker", [{ ticker, edgar_fetched_at: new Date().toISOString() }]);
}

function valuesByDate(series: QuarterlySeries) {
  return new Map(series.ends.map((date, index) => [date, series.values[index]]));
}

export async function saveFundamentals(ticker: string, edgar: EdgarFundamentals) {
  // Database triggers merge with the existing snapshot and update quarterly rows together.
  const [stored] = await rest<Pick<StoredTicker, "edgar_snapshot">[]>(
    "tickers", { on_conflict: "ticker", select: "edgar_snapshot" },
    [{ ticker, cik: edgar.cik, name: edgar.entityName, edgar_snapshot: edgar, edgar_fetched_at: new Date().toISOString() }],
    "POST", "resolution=merge-duplicates,return=representation",
  );
  if (!stored?.edgar_snapshot) throw new Error("Supabase did not return the merged financial snapshot");
  return stored.edgar_snapshot;
}

export function calculateValuations(edgar: EdgarFundamentals, history: StockHistory | null): ValuationPoint[] {
  if (!history || (edgar.reportingCurrency ?? "USD") !== "USD") return [];
  const { ends, values } = edgar.operatingIncome;
  const tax = valuesByDate(edgar.tax);
  const pretax = valuesByDate(edgar.pretax);
  const points: ValuationPoint[] = [];
  for (let i = 3; i < ends.length; i++) {
    const quarter = ends[i];
    const window = ends.slice(i - 3, i + 1);
    const days = (Date.parse(quarter) - Date.parse(window[0])) / 86_400_000;
    if (days < 240 || days > 310) continue;
    const index = history.dates.findLastIndex((date) => date <= quarter);
    if (index < 0 || Date.parse(quarter) - Date.parse(history.dates[index]) > 7 * 86_400_000) continue;
    const balance = edgar.balances[quarter];
    if (!balance || balance.cash === null || balance.debt === null || balance.shares === null) continue;
    const close = history.rawCloses?.[index];
    if (close == null) continue;
    const ev = close * balance.shares + balance.debt - balance.cash;
    const sum = (metric: Map<string, number>) => window.every((date) => metric.has(date))
      ? window.reduce((total, date) => total + (metric.get(date) ?? 0), 0) : null;
    const taxSum = sum(tax);
    const pretaxSum = sum(pretax);
    const effectiveRate = taxSum !== null && pretaxSum !== null && pretaxSum > 0 ? taxSum / pretaxSum : 0.21;
    const rate = effectiveRate >= 0 && effectiveRate <= 1 ? effectiveRate : 0.21;
    const nopat = values.slice(i - 3, i + 1).reduce((total, value) => total + value, 0) * (1 - rate);
    if (ev > 0 && nopat > 0) points.push({ quarter, close, ev, nopat, ev_nopat: ev / nopat });
  }
  return points.slice(-40);
}

export function saveValuations(ticker: string, points: ValuationPoint[]) {
  return upsert("valuation_history", "ticker,quarter", points.map((point) => ({ ticker, ...point })));
}

export async function readValuations(ticker: string) {
  const rows = await rest<ValuationPoint[]>("valuation_history", {
    ticker: "eq." + ticker, select: "quarter,close,ev,nopat,ev_nopat", order: "quarter.desc", limit: "40",
  });
  return rows.reverse();
}

export async function valuationReviewTickers() {
  return rest<Pick<StoredTicker, "ticker" | "edgar_snapshot">[]>("tickers", {
    select: "ticker,edgar_snapshot", edgar_snapshot: "not.is.null", order: "ticker",
  });
}

export async function valuationAuditTickers() {
  return rest<Pick<StoredTicker, "ticker" | "cik" | "edgar_snapshot" | "edgar_fetched_at">[]>("tickers", {
    select: "ticker,cik,edgar_snapshot,edgar_fetched_at", order: "ticker",
  });
}

export function readQuarterlyValuationInputs(ticker: string) {
  return rest<{
    quarter: string; reporting_currency: string; operating_income: number | null; revenue: number | null;
    tax: number | null; pretax: number | null; cash: number | null; debt: number | null;
    shares: number | null; sti: number | string | null;
  }[]>("fundamentals_quarterly", {
    ticker: "eq." + ticker, select: "quarter,reporting_currency,revenue,operating_income,tax,pretax,cash,debt,shares,sti",
    order: "quarter",
  });
}

export async function saveValuationReview(ticker: string, edgar: EdgarFundamentals, history: StockHistory | null): Promise<StoredValuation> {
  if (!canReviewValuation(ticker, edgar)) return { points: [], current: null };
  const calculator = prepareValuationReview(ticker, edgar, history);
  const result = { points: calculator.history(), current: calculator.atLatestClose() };
  await upsert("valuation_history_review", "ticker", [{ ticker, points: result.points, current_point: result.current }]);
  return result;
}

export async function readValuationReview(ticker: string): Promise<StoredValuation> {
  const [row] = await rest<{ points: ValuationPoint[]; current_point: CurrentValuation | null }[]>(
    "valuation_history_review", { select: "points,current_point", ticker: "eq." + ticker, limit: "1" },
  );
  return { points: row?.points ?? [], current: row?.current_point ?? null };
}
