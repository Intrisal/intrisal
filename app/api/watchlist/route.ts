import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { normalizeWatchlist, readUserWatchlist, writeUserWatchlist } from "@/lib/watchlistStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const tickers = await readUserWatchlist(session.sub);
    return NextResponse.json({ tickers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const body = (await request.json().catch(() => null)) as { tickers?: unknown } | null;
    const tickers = await writeUserWatchlist(session.sub, normalizeWatchlist(body?.tickers));
    return NextResponse.json({ tickers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
