import { NextResponse } from "next/server";
import { searchEdgarTickers } from "@/lib/edgar";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 80) return NextResponse.json([]);
  try {
    return NextResponse.json(await searchEdgarTickers(query), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return NextResponse.json([], { status: 503 });
  }
}
