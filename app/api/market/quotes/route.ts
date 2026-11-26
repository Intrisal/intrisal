import { NextResponse } from "next/server";
import { hasStockStore, readStoredQuotes } from "@/lib/stockStore";

export const dynamic = "force-dynamic";

/** GET /api/market/quotes?symbols=NVDA,MSFT — latest prices + day change. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols")?.trim() ?? "";
  const symbols = [...new Set(raw
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean))];
  if (!symbols.length || symbols.length > 60 || symbols.some((symbol) => !/^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/.test(symbol))) {
    return NextResponse.json({ error: "Valid symbols are required" }, { status: 400 });
  }
  if (!hasStockStore()) {
    return NextResponse.json({ error: "Price storage is not configured" }, { status: 503 });
  }

  try {
    const quotes = await readStoredQuotes(symbols);
    return NextResponse.json(
      { quotes },
      { headers: { "Cache-Control": "private, max-age=120" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not read stored quotes" }, { status: 502 });
  }
}
