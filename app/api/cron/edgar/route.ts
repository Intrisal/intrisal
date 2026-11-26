import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { refreshCompanyFilings } from "@/lib/companyData";
import { hasStockStore, trackedTickers } from "@/lib/stockStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Refresh filings for stocks previously requested by visitors.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasStockStore()) return NextResponse.json({ error: "Stock storage unavailable" }, { status: 503 });
  const tickers = await trackedTickers().catch(() => null);
  if (!tickers) return NextResponse.json({ error: "Unable to read stock storage" }, { status: 502 });
  const results: Array<{ ticker: string; ok: boolean }> = [];
  for (const ticker of tickers) {
    try {
      results.push({ ticker, ok: await refreshCompanyFilings(ticker) });
    } catch (error) {
      console.error("Cron filing refresh failed for " + ticker, error);
      results.push({ ticker, ok: false });
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    results,
  }, { status: results.length && results.every(({ ok }) => !ok) ? 502 : 200 });
}
