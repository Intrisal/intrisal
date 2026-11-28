import { NextResponse } from "next/server";
import { getCompanySnapshot, type CompanySnapshot } from "@/lib/companyData";
import { loadLatestDailyValuation } from "@/lib/dailyValuation";
import { trailingGrowth } from "@/lib/fiscalQuarter";
import { sanitizeHistory, stockSignal } from "@/lib/stockSignal";
import { readPrices } from "@/lib/stockStore";

export const dynamic = "force-dynamic";

async function loadSignal(snapshot: CompanySnapshot) {
  const revenueGrowth = !snapshot.isFund && snapshot.sources.fundamentals === "edgar"
    ? trailingGrowth(snapshot.revenueHistory, snapshot.filingDates?.revenue) : null;
  const revenueSignal = stockSignal(revenueGrowth, null);
  if (revenueSignal) return revenueSignal;

  const recent = await readPrices(snapshot.ticker, 252);
  if (!recent) return null;
  const history = sanitizeHistory(recent);
  const validCloses = history.closes.filter((close) => Number.isFinite(close) && close > 0).length;
  if (recent.closes.length === 252 && validCloses < 200) {
    const full = await readPrices(snapshot.ticker);
    return stockSignal(revenueGrowth, full ? sanitizeHistory(full) : history);
  }
  return stockSignal(revenueGrowth, history);
}

/**
 * GET /api/fundamentals?symbol=NVDA
 * GET /api/fundamentals?symbols=NVDA,MSFT,AAPL&view=watchlist — batch with watchlist metrics.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const many = url.searchParams.get("symbols")?.split(/[, ]+/).map((s) => s.trim()).filter(Boolean) ?? [];
  const one = url.searchParams.get("symbol")?.trim();
  const symbols = many.length ? many : one ? [one] : [];
  const includeWatchlistMetrics = many.length > 0 && url.searchParams.get("view") === "watchlist";

  if (!symbols.length) {
    return NextResponse.json({ error: "symbol or symbols is required" }, { status: 400 });
  }

  try {
    // Sequential to respect SEC fair-access spacing inside the EDGAR client.
    const snapshots = [];
    for (const symbol of symbols.slice(0, 12)) {
      const snapshot = await getCompanySnapshot(symbol);
      if (!includeWatchlistMetrics) {
        snapshots.push(snapshot);
        continue;
      }

      const canLoadDailyValuation = snapshot.valuationReview && !snapshot.isFund &&
        !snapshot.valuationHidden && !snapshot.valuationHasNegativeOperatingIncome &&
        snapshot.valuationAverageYears != null && snapshot.evNopatAvg != null;
      const [latestDailyValuation, signal] = await Promise.all([
        canLoadDailyValuation ? loadLatestDailyValuation(snapshot.ticker).catch((error: unknown) => {
          console.error("Could not load daily EV/NOPAT for " + snapshot.ticker, error);
          return null;
        }) : null,
        loadSignal(snapshot).catch((error: unknown) => {
          console.error("Could not load stock signal for " + snapshot.ticker, error);
          return null;
        }),
      ]);
      snapshots.push({ ...snapshot, latestDailyValuation, signal });
    }

    if (many.length) {
      const bySymbol: Record<string, (typeof snapshots)[number]> = {};
      for (const snap of snapshots) bySymbol[snap.ticker] = snap;
      return NextResponse.json(
        { snapshots: bySymbol },
        { headers: { "Cache-Control": "private, max-age=120, must-revalidate" } },
      );
    }

    return NextResponse.json(snapshots[0], {
      headers: { "Cache-Control": "private, max-age=120, must-revalidate" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load fundamentals";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
