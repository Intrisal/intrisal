import { NextResponse } from "next/server";
import { fetchQuotes, hasMarketstackKey } from "@/lib/marketstack";

export const dynamic = "force-dynamic";

/** GET /api/market/quotes?symbols=NVDA,MSFT — latest prices + day change. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols")?.trim() ?? "";
  const symbols = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!symbols.length) {
    return NextResponse.json({ error: "symbols is required" }, { status: 400 });
  }
  if (!hasMarketstackKey()) {
    return NextResponse.json({ error: "MARKETSTACK_API_KEY is not configured" }, { status: 503 });
  }

  try {
    const quotes = await fetchQuotes(symbols);
    return NextResponse.json(
      { quotes },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load quotes";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
