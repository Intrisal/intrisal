import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cronAuth";
import { refreshCompanyFilings } from "@/lib/companyData";
import { hasStockStore, trackedTickers } from "@/lib/stockStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 48_000;

/**
 * Refresh SEC filings for the stalest tracked stocks, bounded by TIME_BUDGET_MS
 * so the full S&P 500 cycles smoothly without hitting serverless timeouts.
 */
export async function GET(request: Request) {
  if (!authorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasStockStore()) return NextResponse.json({ error: "Stock storage unavailable" }, { status: 503 });
  const startedAt = Date.now();
  const tickers = await trackedTickers(50).catch(() => null);
  if (!tickers) return NextResponse.json({ error: "Unable to read stock storage" }, { status: 502 });

  const results: Array<{ ticker: string; status: string }> = [];
  for (const ticker of tickers) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    try {
      results.push({ ticker, status: await refreshCompanyFilings(ticker) });
    } catch (error) {
      console.error("Cron filing refresh failed for " + ticker, error);
      results.push({ ticker, status: "error" });
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    attempted: results.length,
    updated: results.filter((r) => r.status === "updated").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  }, { status: results.length && results.every(({ status }) => status === "error") ? 502 : 200 });
}
