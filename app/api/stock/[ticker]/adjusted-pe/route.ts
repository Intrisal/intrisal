import { NextResponse } from "next/server";
import { loadAdjustedPe } from "@/lib/adjustedPe";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const ticker = (await params).ticker.toUpperCase();
  if (ticker !== "AMZN" && ticker !== "GOOG") {
    return NextResponse.json({ error: "Adjusted P/E unavailable for this stock" }, { status: 404 });
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
