import { unstable_cache } from "next/cache";
import { listFinancialFilings } from "@/lib/edgar";
import { isStoredFund, readPrices, readTicker } from "@/lib/stockStore";
import { canReviewValuation, prepareValuationReview, valuationHistorySpanYears } from "@/lib/valuationReview";

const cachedFilings = unstable_cache(listFinancialFilings, ["daily-valuation-sec-filings"], { revalidate: 3600 });

export async function loadDailyValuation(ticker: string) {
  const stored = await readTicker(ticker);
  const edgar = stored?.edgar_snapshot;
  if (isStoredFund(stored) || !edgar?.cik || (edgar.reportingCurrency ?? "USD") !== "USD" || !canReviewValuation(ticker, edgar)) {
    return [];
  }
  const calculator = prepareValuationReview(ticker, edgar, null);
  if (calculator.financialQuarters().some(({ negativeOperatingIncome }) => negativeOperatingIncome)) return [];

  const history = await readPrices(ticker);
  if (!history) return [];
  const start = `${Number(history.asOf.slice(0, 4)) - 11}-01-01`;
  const filings = await cachedFilings(edgar.cik, start);
  const daily = prepareValuationReview(ticker, edgar, history).dailyHistory(filings);
  const coveredDates = daily.flatMap(({ date, point }) => point ? [{ quarter: date }] : []);
  // Allow a partial first quarter within the minimum five-year window.
  const enoughHistory = valuationHistorySpanYears(coveredDates) >= 4.75 && coveredDates.length >= 1000;
  return enoughHistory ? daily : [];
}

export const loadLatestDailyValuation = unstable_cache(async (ticker: string) => {
  const latest = (await loadDailyValuation(ticker)).findLast(({ point }) => point !== null);
  if (!latest?.point) return null;
  return { date: latest.date, multiple: latest.point.ev_nopat };
}, ["latest-daily-valuation"], { revalidate: 300 });
