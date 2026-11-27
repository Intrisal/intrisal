import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cronAuth";
import { refreshStoredValuations } from "@/lib/companyData";
import { normalizeTicker } from "@/lib/market";
import {
  fetchBatchLatestEod,
  hasMarketstackKey,
  MarketstackQuotaError,
} from "@/lib/marketstack";
import {
  hasStockStore,
  readLatestPriceDate,
  readTicker,
  saveBatchPrices,
  trackedPriceTickers,
} from "@/lib/stockStore";
import { canReviewValuation } from "@/lib/valuationReview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 48_000;
const easternClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function latestExpectedClose(now: Date) {
  const parts = Object.fromEntries(easternClock.formatToParts(now).map(({ type, value }) => [type, value]));
  const day = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  if (Number(parts.hour) < 17) day.setUTCDate(day.getUTCDate() - 1);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function daysAgoIso(now: Date, days: number) {
  const d = new Date(now.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasStockStore() || !hasMarketstackKey()) {
    return NextResponse.json({ error: "Price refresh is not configured" }, { status: 503 });
  }

  const startedAt = Date.now();
  const now = new Date();
  const fetchedAt = now.toISOString();
  const expectedClose = latestExpectedClose(now);

  const envList = process.env.MARKETSTACK_REFRESH_TICKERS?.trim();
  const tracked = envList
    ? [...new Set(envList.split(",").map(normalizeTicker).filter((t) => /^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/.test(t)))]
        .map((ticker) => ({ ticker, prices_fetched_at: null as string | null }))
    : await trackedPriceTickers();

  if (!tracked.length) {
    return NextResponse.json({ expectedClose, total: 0, updated: 0, valuationsRefreshed: 0 });
  }

  const dateFrom = daysAgoIso(now, 7);
  const allTickers = tracked.map((t) => t.ticker);
  let quotaReached = false;
  let barsByTicker = new Map<string, Awaited<ReturnType<typeof fetchBatchLatestEod>> extends Map<string, infer V> ? V : never>();

  try {
    barsByTicker = await fetchBatchLatestEod(allTickers, dateFrom);
  } catch (error) {
    if (error instanceof MarketstackQuotaError) {
      quotaReached = true;
    } else {
      console.error("Batch price refresh failed", error);
      return NextResponse.json({ error: "Batch price fetch failed" }, { status: 502 });
    }
  }

  const newRows: { ticker: string; date: string; close: number; adjusted_close: number }[] = [];
  const updatedTickers: string[] = [];
  const touchedTickers: string[] = [];

  for (let offset = 0; offset < allTickers.length; offset += 25) {
    const slice = allTickers.slice(offset, offset + 25);
    await Promise.all(slice.map(async (ticker) => {
      const bars = barsByTicker.get(ticker);
      if (!bars?.length) return;
      touchedTickers.push(ticker);
      const lastDate = await readLatestPriceDate(ticker);
      const freshBars = lastDate ? bars.filter((b) => b.date >= lastDate) : bars;
      if (!freshBars.length) return;
      for (const bar of freshBars) {
        if (bar.rawClose != null) {
          newRows.push({ ticker, date: bar.date, close: bar.rawClose, adjusted_close: bar.close });
        }
      }
      if (!lastDate || freshBars.at(-1)!.date > lastDate) {
        updatedTickers.push(ticker);
      }
    }));
  }

  await saveBatchPrices(newRows, touchedTickers, fetchedAt);

  // Recalculate valuations for tickers that received a new close (bounded by TIME_BUDGET_MS).
  let valuationsRefreshed = 0;
  for (let offset = 0; offset < updatedTickers.length; offset += 8) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const slice = updatedTickers.slice(offset, offset + 8);
    await Promise.all(slice.map(async (ticker) => {
      try {
        const stored = await readTicker(ticker);
        if (stored?.edgar_snapshot && canReviewValuation(ticker, stored.edgar_snapshot)) {
          await refreshStoredValuations(ticker, stored.edgar_snapshot);
          valuationsRefreshed++;
        }
      } catch (error) {
        console.error("Valuation refresh failed after price update for " + ticker, error);
      }
    }));
  }

  return NextResponse.json({
    expectedClose,
    ranAt: fetchedAt,
    total: allTickers.length,
    barsImported: newRows.length,
    updated: updatedTickers.length,
    valuationsRefreshed,
    quotaReached,
    oldestPriceFetchedAt: tracked[0]?.prices_fetched_at ?? null,
  }, { status: quotaReached ? 429 : 200 });
}
