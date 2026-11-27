import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { listFinancialFilings } from "@/lib/edgar";
import { normalizeTicker } from "@/lib/market";
import { isStoredFund, readPrices, readTicker } from "@/lib/stockStore";
import { canReviewValuation, prepareValuationReview, valuationHistorySpanYears } from "@/lib/valuationReview";

const cachedFilings = unstable_cache(listFinancialFilings, ["daily-valuation-sec-filings"], { revalidate: 3600 });

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const ticker = normalizeTicker((await params).ticker);
  if (!/^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  try {
    const stored = await readTicker(ticker);
    const edgar = stored?.edgar_snapshot;
    if (isStoredFund(stored) || !edgar?.cik || (edgar.reportingCurrency ?? "USD") !== "USD" || !canReviewValuation(ticker, edgar)) {
      return NextResponse.json({ daily: [] });
    }
    const calculator = prepareValuationReview(ticker, edgar, null);
    if (calculator.financialQuarters().some(({ negativeOperatingIncome }) => negativeOperatingIncome)) {
      return NextResponse.json({ daily: [] });
    }
    const history = await readPrices(ticker);
    if (!history) return NextResponse.json({ daily: [] });
    const start = `${Number(history.asOf.slice(0, 4)) - 11}-01-01`;
    const filings = await cachedFilings(edgar.cik, start);
    const daily = prepareValuationReview(ticker, edgar, history).dailyHistory(filings);
    const coveredDates = daily.flatMap(({ date, point }) => point ? [{ quarter: date }] : []);
    // Allow a partial first quarter within the minimum five-year window.
    const enoughHistory = valuationHistorySpanYears(coveredDates) >= 4.75 && coveredDates.length >= 1000;
    return NextResponse.json({ daily: enoughHistory ? daily : [] }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    console.error("Could not load daily EV/NOPAT for " + ticker, error);
    return NextResponse.json({ error: "Daily valuation unavailable" }, { status: 503 });
  }
}
