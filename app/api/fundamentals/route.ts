import { NextResponse } from "next/server";
import { getCompanySnapshot } from "@/lib/companyData";

export const dynamic = "force-dynamic";

/**
 * GET /api/fundamentals?symbol=NVDA
 * GET /api/fundamentals?symbols=NVDA,MSFT,AAPL — batch (watchlist valuation).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const many = url.searchParams.get("symbols")?.split(/[, ]+/).map((s) => s.trim()).filter(Boolean) ?? [];
  const one = url.searchParams.get("symbol")?.trim();
  const symbols = many.length ? many : one ? [one] : [];

  if (!symbols.length) {
    return NextResponse.json({ error: "symbol or symbols is required" }, { status: 400 });
  }

  try {
    // Sequential to respect SEC fair-access spacing inside the EDGAR client.
    const snapshots = [];
    for (const symbol of symbols.slice(0, 12)) {
      snapshots.push(await getCompanySnapshot(symbol));
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
