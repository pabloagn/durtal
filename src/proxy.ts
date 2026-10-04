import { NextResponse, type NextRequest } from "next/server";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { PAGE_SIZES } from "@/lib/utils/pagination";
import { perPageCookieName } from "@/lib/utils/preference-cookies";

/**
 * API routes refuse calls from web pages on other origins (task 0255).
 *
 * A list page opened without `perPage` redirects to the page size saved for
 * it, before anything renders. The list loads once, at the right size.
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return crossOriginRefusal(request) ?? undefined;
  }
  if (request.method !== "GET") return;
  const url = request.nextUrl.clone();
  if (url.searchParams.has("perPage")) return;
  const saved = Number(request.cookies.get(perPageCookieName(url.pathname))?.value);
  if (!PAGE_SIZES.some((size) => size === saved)) return;
  url.searchParams.set("perPage", String(saved));
  return NextResponse.redirect(url);
}

export const config = {
  // Pages (no build assets or files), and the API routes
  matcher: ["/((?!api/|_next/|.*\\.).*)", "/api/:path*"],
};
