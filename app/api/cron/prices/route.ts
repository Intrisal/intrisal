import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cronAuth";
import { DEFAULT_WATCHLIST } from "@/lib/market";
import { fetchStockHistory, hasMarketstackKey, MarketstackQuotaError } from "@/lib/marketstack";
import {
  calculateValuations, claimPriceRefresh, hasStockStore, readLatestPriceDate, readPrices,
  readTicker, savePrices, saveValuations,
} from "@/lib/stockStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const easternClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hourCycle: "h23",
});

function latestExpectedClose(now: Date) {
  const parts = Object.fromEntries(easternClock.formatToParts(now).map(({ type, value }) => [type, value]));
  const day = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  if (Number(parts.hour) < 17) day.setUTCDate(day.getUTCDate() - 1);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

async function refreshPrice(ticker: string, expectedClose: string, now: Date) {
  const lastDate = await readLatestPriceDate(ticker);
  if (lastDate && lastDate >= expectedClose) return "current";
  if (!await claimPriceRefresh(ticker, now)) return "already_attempted";
  const delta = await fetchStockHistory(ticker, lastDate);
  if (!delta) return "no_bars";
  await savePrices(ticker, delta);
  const stored = await readTicker(ticker);
  if (stored?.edgar_snapshot) {
    await saveValuations(ticker, calculateValuations(stored.edgar_snapshot, await readPrices(ticker)));
  }
  return !lastDate || delta.asOf > lastDate ? "updated" : "no_new_close";
}

export async function GET(request: Request) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasStockStore() || !hasMarketstackKey()) {
    return NextResponse.json({ error: "Price refresh is not configured" }, { status: 503 });
  }
  const now = new Date();
  const expectedClose = latestExpectedClose(now);
  const symbols = [...new Set((process.env.MARKETSTACK_REFRESH_TICKERS || DEFAULT_WATCHLIST.join(","))
    .split(",").map((ticker) => ticker.trim().toUpperCase()).filter((ticker) => /^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/.test(ticker)))];
  if (!symbols.length || symbols.length > 12) {
    return NextResponse.json({ error: "Configure between 1 and 12 price refresh tickers" }, { status: 503 });
  }

  const results: { ticker: string; status: string }[] = [];
  let quotaReached = false;
  for (let offset = 0; offset < symbols.length && !quotaReached; offset += 3) {
    results.push(...await Promise.all(symbols.slice(offset, offset + 3).map(async (ticker) => {
      try {
        return { ticker, status: await refreshPrice(ticker, expectedClose, now) };
      } catch (error) {
        if (error instanceof MarketstackQuotaError) {
          quotaReached = true;
          return { ticker, status: "quota_exhausted" };
        }
        console.error("Price refresh failed for " + ticker, error);
        return { ticker, status: "error" };
      }
    })));
  }
  return NextResponse.json({ expectedClose, quotaReached, results }, {
    status: quotaReached ? 429 : results.some(({ status }) => status === "error") ? 502 : 200,
  });
}
