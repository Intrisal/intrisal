import { NextResponse } from "next/server";
import { searchEdgarTickers } from "@/lib/edgar";
import { isCanadianFund, searchMatchScore } from "@/lib/market";
import { readStoredFundDirectory } from "@/lib/stockStore";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 80) return NextResponse.json([]);
  const [funds, edgar] = await Promise.allSettled([readStoredFundDirectory(), searchEdgarTickers(query)]);
  if (funds.status === "rejected" && edgar.status === "rejected") {
    return NextResponse.json([], { status: 503 });
  }
  const matches = new Map<string, string>(
    edgar.status === "fulfilled" ? edgar.value.filter(([ticker]) => !isCanadianFund(ticker)) : [],
  );
  if (funds.status === "fulfilled") {
    for (const [ticker, name] of funds.value) matches.set(ticker, name);
  }
  const ranked = [...matches].map(([ticker, name]) => ({ ticker, name, score: searchMatchScore(query, ticker, name) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.ticker.localeCompare(b.ticker))
    .slice(0, 8).map(({ ticker, name }) => [ticker, name]);
  return NextResponse.json(ranked, {
    headers: { "Cache-Control": funds.status === "fulfilled" && edgar.status === "fulfilled"
      ? "public, max-age=300" : "no-store" },
  });
}
