import { NextResponse } from "next/server";
import { getCompanySnapshot } from "@/lib/companyData";
import { lookupStockKind } from "@/lib/edgar";
import { exchangeOf, isKnownFund, normalizeTicker } from "@/lib/market";
import { hasStockStore, readStoredStockKind } from "@/lib/stockStore";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const ticker = normalizeTicker((await params).ticker);
  if (!/^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  let isFund = isKnownFund(ticker);
  if (!isFund && !exchangeOf(ticker)) {
    try {
      const storedKind = hasStockStore() ? await readStoredStockKind(ticker).catch(() => null) : null;
      const kind = storedKind ?? await lookupStockKind(ticker);
      if (!kind) return NextResponse.json({ error: "Ticker not found" }, { status: 404 });
      isFund = kind === "fund";
    } catch {
      return NextResponse.json({ error: "Stock lookup unavailable" }, { status: 503 });
    }
  }
  return NextResponse.json(await getCompanySnapshot(ticker, isFund));
}
