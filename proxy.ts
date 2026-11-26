import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromCookieHeader } from "@/lib/authSession";

/**
 * Gate the product surface and its data APIs.
 * Signed-in users may still visit the landing page; login/signup redirect home.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await getSessionFromCookieHeader(request.headers.get("cookie"));

  if (session && (pathname === "/login" || pathname === "/signup")) {
    const home = request.nextUrl.clone();
    home.pathname = "/home";
    home.search = "";
    return NextResponse.redirect(home);
  }

  const needsAuth =
    pathname.startsWith("/home") ||
    pathname.startsWith("/api/stock") ||
    pathname.startsWith("/api/market") ||
    pathname.startsWith("/api/fundamentals");

  if (!needsAuth || session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.searchParams.set("auth", "required");
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/signup",
    "/home",
    "/home/:path*",
    "/api/stock/:path*",
    "/api/market/:path*",
    "/api/fundamentals",
  ],
};
