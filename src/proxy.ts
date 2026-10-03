import { NextResponse, type NextRequest } from "next/server";
import { PAGE_SIZES } from "@/lib/utils/pagination";
import { perPageCookieName } from "@/lib/utils/preference-cookies";

/**
 * A list page opened without `perPage` redirects to the page size saved for
 * it, before anything renders. The list loads once, at the right size.
 */
export function proxy(request: NextRequest) {
  if (request.method !== "GET") return;
  const url = request.nextUrl.clone();
  if (url.searchParams.has("perPage")) return;
  const saved = Number(request.cookies.get(perPageCookieName(url.pathname))?.value);
  if (!PAGE_SIZES.some((size) => size === saved)) return;
  url.searchParams.set("perPage", String(saved));
  return NextResponse.redirect(url);
}

export const config = {
  // Pages only: no API routes, build assets or files
  matcher: ["/((?!api/|_next/|.*\\.).*)"],
};
