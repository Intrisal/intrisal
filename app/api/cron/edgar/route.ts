import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cronAuth";
import { refreshCompanyFilings } from "@/lib/companyData";
import { hasStockStore, trackedTickers } from "@/lib/stockStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Refresh filings for stocks previously requested by visitors.
 */
export async function GET(request: Request) {
  if (!authorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasStockStore()) return NextResponse.json({ error: "Stock storage unavailable" }, { status: 503 });
  const tickers = await trackedTickers().catch(() => null);
  if (!tickers) return NextResponse.json({ error: "Unable to read stock storage" }, { status: 502 });
  const results: Array<{ ticker: string; status: string }> = [];
  for (const ticker of tickers) {
    try {
      results.push({ ticker, status: await refreshCompanyFilings(ticker) });
    } catch (error) {
      console.error("Cron filing refresh failed for " + ticker, error);
      results.push({ ticker, status: "error" });
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    results,
  }, { status: results.length && results.every(({ status }) => status === "error") ? 502 : 200 });
}
