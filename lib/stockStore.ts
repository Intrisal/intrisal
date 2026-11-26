import type { EdgarFundamentals, QuarterlySeries } from "@/lib/edgar";
import type { StockHistory } from "@/lib/marketstack";

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

async function rest<T>(table: string, query: Record<string, string>, rows?: object[]): Promise<T> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Supabase credentials are missing");
  const url = new URL("/rest/v1/" + table, base);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    method: rows ? "POST" : "GET",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "User-Agent": "Intrisal-server/1.0",
      ...(rows ? { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" } : {}),
    },
    body: rows ? JSON.stringify(rows) : undefined,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Supabase ${table} HTTP ${response.status}`);
  return rows ? undefined as T : response.json();
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

export async function readPrices(ticker: string): Promise<StockHistory | null> {
  const rows = await rest<{ date: string; close: number; adjusted_close: number | null }[]>("price_history", {
    ticker: "eq." + ticker, select: "date,close,adjusted_close", order: "date.desc", limit: "1000",
  });
  if (!rows.length) return null;
  const last = rows[0];
  const previous = rows[1]?.close ?? last.close;
  const year = rows.slice(0, 252).map(({ close, adjusted_close }) => adjusted_close ?? close);
  rows.reverse();
  return {
    ticker, symbol: ticker, dates: rows.map(({ date }) => date),
    closes: rows.map(({ close, adjusted_close }) => adjusted_close ?? close),
    rawCloses: rows.map(({ close }) => close),
    price: last.close, change: (last.close / previous - 1) * 100,
    high52: Math.max(...year), low52: Math.min(...year), asOf: last.date, source: "marketstack",
  };
}

export async function savePrices(ticker: string, history: StockHistory) {
  await upsert("tickers", "ticker", [{ ticker }]);
  const rows = new Map<string, { ticker: string; date: string; close: number; adjusted_close: number }>();
  for (const [index, date] of history.dates.entries()) {
    const close = history.rawCloses?.[index];
    if (close != null) rows.set(date, { ticker, date, close, adjusted_close: history.closes[index] });
  }
  if (!rows.size) return;
  await upsert("price_history", "ticker,date", [...rows.values()]);
  await upsert("tickers", "ticker", [{ ticker, prices_fetched_at: new Date().toISOString() }]);
}

function valuesByDate(series: QuarterlySeries) {
  return new Map(series.ends.map((date, index) => [date, series.values[index]]));
}

export async function saveFundamentals(ticker: string, edgar: EdgarFundamentals) {
  await upsert("tickers", "ticker", [{ ticker, cik: edgar.cik, name: edgar.entityName }]);
  const metrics = {
    revenue: valuesByDate(edgar.revenue), operating_income: valuesByDate(edgar.operatingIncome),
    diluted_eps: valuesByDate(edgar.dilutedEps), free_cash_flow: valuesByDate(edgar.freeCashFlow),
    tax: valuesByDate(edgar.tax), pretax: valuesByDate(edgar.pretax),
  };
  const dates = new Set(Object.values(metrics).flatMap((series) => [...series.keys()]));
  await upsert("fundamentals_quarterly", "ticker,quarter", [...dates].map((quarter) => ({
    ticker, quarter, ...(edgar.balances[quarter] ?? { debt: null, cash: null, shares: null }),
    ...Object.fromEntries(Object.entries(metrics).map(([name, series]) => [name, series.get(quarter) ?? null])),
  })));
  await upsert("tickers", "ticker", [{ ticker, edgar_snapshot: edgar, edgar_fetched_at: new Date().toISOString() }]);
}

export function calculateValuations(edgar: EdgarFundamentals, history: StockHistory | null): ValuationPoint[] {
  if (!history) return [];
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
