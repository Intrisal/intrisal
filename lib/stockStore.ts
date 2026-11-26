import type { EdgarFundamentals, QuarterlySeries } from "@/lib/edgar";
import { marketstackSymbol, type StockHistory, type StockQuote } from "@/lib/marketstack";

export type ValuationPoint = { quarter: string; close: number; ev: number; nopat: number; ev_nopat: number };
type StoredTicker = {
  ticker: string;
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

export async function readTicker(ticker: string) {
  const [row] = await rest<StoredTicker[]>("tickers", { ticker: "eq." + ticker, limit: "1" });
  return row;
}

export async function trackedTickers() {
  const rows = await rest<{ ticker: string }[]>("tickers", {
    select: "ticker", ticker: "not.is.null", order: "edgar_fetched_at.asc.nullsfirst", limit: "12",
  });
  return rows.map(({ ticker }) => ticker);
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

export async function readStoredQuotes(tickers: string[]): Promise<Record<string, StockQuote>> {
  const entries = await Promise.all(tickers.map(async (ticker) => {
    const [last, previous] = await priceRows(ticker, 2);
    if (!last) return null;
    return [ticker, {
      ticker, price: last.close, change: (last.close / (previous?.close ?? last.close) - 1) * 100,
      date: last.date, source: "marketstack",
    } satisfies StockQuote] as const;
  }));
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

export async function claimPriceRefresh(ticker: string, now: Date) {
  await rest("tickers", { on_conflict: "ticker" }, [{ ticker }], "POST", "resolution=ignore-duplicates,return=minimal");
  const today = now.toISOString().slice(0, 10) + "T00:00:00Z";
  const rows = await rest<{ ticker: string }[]>("tickers", {
    ticker: "eq." + ticker, or: `(prices_fetched_at.is.null,prices_fetched_at.lt.${today})`, select: "ticker",
  }, { prices_fetched_at: now.toISOString() }, "PATCH", "return=representation");
  return rows.length > 0;
}

export async function readPrices(ticker: string, maxRows = 1500): Promise<StockHistory | null> {
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
  if (!history || edgar.reportingCurrency === "EUR") return [];
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
