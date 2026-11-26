import { NextResponse } from "next/server";
import { getCompanySnapshot } from "@/lib/companyData";
import { resolveCik } from "@/lib/edgar";
import { CATALOG } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const ticker = (await params).ticker.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  if (!CATALOG.some(([symbol]) => symbol === ticker)) {
    try {
      if (!await resolveCik(ticker)) return NextResponse.json({ error: "Ticker not found" }, { status: 404 });
    } catch {
      return NextResponse.json({ error: "Stock lookup unavailable" }, { status: 503 });
    }
  }
  return NextResponse.json(await getCompanySnapshot(ticker));
}
