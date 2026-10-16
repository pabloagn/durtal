import { NextResponse, type NextRequest } from "next/server";
import { hostRefusal } from "@/lib/api/allowed-hosts";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { PAGE_SIZES } from "@/lib/utils/pagination";
import { perPageCookieName } from "@/lib/utils/preference-cookies";
import { makeNonce, READER_PAGE_RE, readerCsp } from "@/lib/reader/csp";
import { LIBRARY_SORT_COOKIE, parseLibrarySortPreference } from "@/lib/library/sort-preference";

/**
 * A request on a name that is not Durtal's is refused first, so a page that
 * points its own name at the Mac (DNS rebinding) reaches nothing (task 0608).
 *
 * API routes refuse calls from web pages on other origins (task 0255).
 *
 * A list page opened without `perPage` redirects to the page size saved for
 * it, before anything renders. The list loads once, at the right size.
 * Books also restores the last explicitly selected sort and direction.
 *
 * A mistyped e-book address is left to its page, whose not-found view leads
 * back to eBooks (SLN-864); the pages never query with an id that is not one.
 *
 * A reader page gets its Content-Security-Policy with a fresh nonce. Its
 * durtal-device cookie is not made here: two reader pages opened at once
 * would make two (SLN-668); the reader asks for one under a lock instead
 * (src/lib/reader/device-handshake.ts).
 */
export function proxy(request: NextRequest) {
  const misdirected = hostRefusal(request);
  if (misdirected) return misdirected;
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return crossOriginRefusal(request) ?? undefined;
  }
  if (READER_PAGE_RE.test(request.nextUrl.pathname)) return readerPage(request);
  if (request.method !== "GET") return;
  const url = request.nextUrl.clone();
  if (url.pathname === "/library" && !url.searchParams.has("sort")) {
    const savedSort = parseLibrarySortPreference(request.cookies.get(LIBRARY_SORT_COOKIE)?.value);
    if (savedSort) {
      url.searchParams.set("sort", savedSort.sort);
      if (!url.searchParams.has("order")) url.searchParams.set("order", savedSort.order);
    }
  }
  if (!url.searchParams.has("perPage")) {
    const saved = Number(request.cookies.get(perPageCookieName(url.pathname))?.value);
    if (PAGE_SIZES.some((size) => size === saved)) url.searchParams.set("perPage", String(saved));
  }
  if (url.href !== request.nextUrl.href) return NextResponse.redirect(url);
}

/** The reader's policy on the request (Next.js puts its nonce on its own scripts) and on the answer */
function readerPage(request: NextRequest) {
  const nonce = makeNonce();
  const csp = readerCsp(nonce, {
    development: process.env.NODE_ENV === "development",
    cdnUrl: process.env.EBOOK_CDN_URL,
  });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything but the build's own files. A path with a dot is a page too: the
  // catch-all not-found page answers it and runs any server action posted to
  // it, so the host guard has to see it (task 0608)
  matcher: ["/((?!api/|_next/).*)", "/api/:path*", "/ebooks/:path*"],
};
