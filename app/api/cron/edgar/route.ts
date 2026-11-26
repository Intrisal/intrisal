import { NextResponse } from "next/server";
import { fetchEdgarFundamentals } from "@/lib/edgar";
import { DEFAULT_WATCHLIST } from "@/lib/market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily warm of EDGAR company facts for the default watchlist.
 * Auth: Authorization: Bearer $CRON_SECRET  (or ?secret=)
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const querySecret = new URL(request.url).searchParams.get("secret") || "";
  if (!secret || (bearer !== secret && querySecret !== secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{ ticker: string; ok: boolean; error?: string }> = [];
  for (const ticker of DEFAULT_WATCHLIST) {
    try {
      const data = await fetchEdgarFundamentals(ticker);
      results.push({ ticker, ok: Boolean(data) });
    } catch (error) {
      results.push({
        ticker,
        ok: false,
        error: error instanceof Error ? error.message : "failed",
      });
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    results,
  });
}
