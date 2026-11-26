import { NextResponse } from "next/server";
import { fetchStockHistory, hasMarketstackKey } from "@/lib/marketstack";

export const dynamic = "force-dynamic";

/** GET /api/market/history?symbol=NVDA — daily closes for charts (server-side Marketstack). */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim() ?? "";
  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }
  if (!hasMarketstackKey()) {
    return NextResponse.json({ error: "MARKETSTACK_API_KEY is not configured" }, { status: 503 });
  }

  try {
    const history = await fetchStockHistory(symbol);
    return NextResponse.json(history, {
      // Short browser cache — EOD is stable, but bad upstream bars must not stick for an hour.
      headers: { "Cache-Control": "private, max-age=120, must-revalidate" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load history";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
