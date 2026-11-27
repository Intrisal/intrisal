import { NextResponse } from "next/server";
import { searchEdgarTickers } from "@/lib/edgar";
import { displayCompanyName, isCanadianFund, isSearchableTicker, searchMatchScore } from "@/lib/market";
import { readStoredTickerDirectory } from "@/lib/stockStore";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 80) return NextResponse.json([]);
  const [stored, edgar] = await Promise.allSettled([readStoredTickerDirectory(), searchEdgarTickers(query)]);
  if (stored.status === "rejected" && edgar.status === "rejected") {
    return NextResponse.json([], { status: 503 });
  }
  const matches = new Map<string, string>(
    edgar.status === "fulfilled" ? edgar.value.filter(([ticker]) => !isCanadianFund(ticker)) : [],
  );
  if (stored.status === "fulfilled") {
    for (const [ticker, name] of stored.value) {
      if (isSearchableTicker(ticker)) matches.set(ticker, name);
    }
  }
  const ranked = [...matches].map(([ticker, rawName]) => {
    const name = displayCompanyName(ticker, rawName);
    return { ticker, name, score: searchMatchScore(query, ticker, name) };
  })
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.ticker.localeCompare(b.ticker))
    .slice(0, 8).map(({ ticker, name }) => [ticker, name]);
  return NextResponse.json(ranked, {
    headers: { "Cache-Control": stored.status === "fulfilled" && edgar.status === "fulfilled"
      ? "public, max-age=300" : "no-store" },
  });
}
