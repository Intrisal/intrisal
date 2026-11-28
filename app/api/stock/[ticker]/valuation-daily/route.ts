import { NextResponse } from "next/server";
import { loadDailyValuation } from "@/lib/dailyValuation";
import { normalizeTicker } from "@/lib/market";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const ticker = normalizeTicker((await params).ticker);
  if (!/^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  try {
    const daily = await loadDailyValuation(ticker);
    return NextResponse.json({ daily }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    console.error("Could not load daily EV/NOPAT for " + ticker, error);
    return NextResponse.json({ error: "Daily valuation unavailable" }, { status: 503 });
  }
}
