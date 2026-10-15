import { NextResponse, type NextRequest } from "next/server";
import { hostRefusal } from "@/lib/api/allowed-hosts";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { PAGE_SIZES } from "@/lib/utils/pagination";
import { perPageCookieName } from "@/lib/utils/preference-cookies";
import { makeNonce, READER_PAGE_RE, readerCsp } from "@/lib/reader/csp";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, isDeviceId } from "@/lib/reader/device";
import { LIBRARY_SORT_COOKIE, parseLibrarySortPreference } from "@/lib/library/sort-preference";
import { isUuid } from "@/lib/utils/uuid";

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
 * A reader page gets its Content-Security-Policy with a fresh nonce, and
 * this device its durtal-device cookie when it has none (eBooks sub-issue 3).
 */
export function proxy(request: NextRequest) {
  const misdirected = hostRefusal(request);
  if (misdirected) return misdirected;
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return crossOriginRefusal(request) ?? undefined;
  }
  const ebookPath = /^\/ebooks\/([^/]+)\/?$/.exec(request.nextUrl.pathname);
  if (ebookPath && !["runs", "review", "highlights", "upload", "offline"].includes(ebookPath[1]) && !isUuid(ebookPath[1]))
    return new NextResponse("Invalid eBook id", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
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
  const saved = request.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = isDeviceId(saved) ? null : crypto.randomUUID();
  if (deviceId) {
    // The page reads the new id in this same request
    const cookie = headers.get("cookie");
    headers.set("cookie", `${cookie ? `${cookie}; ` : ""}${DEVICE_COOKIE}=${deviceId}`);
  }
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  if (deviceId) {
    response.cookies.set(DEVICE_COOKIE, deviceId, {
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}

export const config = {
  // Pages (no build assets or files), and the API routes
  matcher: ["/((?!api/|_next/|.*\\.).*)", "/api/:path*", "/ebooks/:path*"],
};
