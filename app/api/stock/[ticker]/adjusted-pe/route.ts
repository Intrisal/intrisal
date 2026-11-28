import { NextResponse } from "next/server";
import { loadAdjustedPe } from "@/lib/adjustedPe";
import { normalizeTicker } from "@/lib/market";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const ticker = normalizeTicker((await params).ticker);
  if (!/^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  try {
    return NextResponse.json({ daily: await loadAdjustedPe(ticker) }, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    console.error("Could not load adjusted P/E for " + ticker, error);
    return NextResponse.json({ error: "Adjusted P/E unavailable" }, { status: 503 });
  }
}
