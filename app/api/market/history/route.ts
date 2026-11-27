import { NextResponse } from "next/server";
import { normalizeTicker } from "@/lib/market";
import { hasStockStore, readPrices } from "@/lib/stockStore";

export const dynamic = "force-dynamic";

/** GET /api/market/history?symbol=NVDA — stored daily closes for charts. */
export async function GET(request: Request) {
  const symbol = normalizeTicker(new URL(request.url).searchParams.get("symbol") ?? "");
  if (!/^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/.test(symbol)) {
    return NextResponse.json({ error: "A valid symbol is required" }, { status: 400 });
  }
  if (!hasStockStore()) {
    return NextResponse.json({ error: "Price storage is not configured" }, { status: 503 });
  }

  try {
    // Allow ten years of sessions plus earlier prices for the moving averages.
    const history = await readPrices(symbol);
    if (!history) return NextResponse.json({ error: "No stored prices for " + symbol }, { status: 404 });
    return NextResponse.json(history, {
      headers: { "Cache-Control": "private, max-age=120, must-revalidate" },
    });
  } catch {
    return NextResponse.json({ error: "Could not read stored price history" }, { status: 502 });
  }
}
