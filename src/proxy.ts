import { NextResponse, type NextRequest } from "next/server";
import { hostRefusal } from "@/lib/api/allowed-hosts";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { PAGE_SIZES } from "@/lib/utils/pagination";
import { perPageCookieName } from "@/lib/utils/preference-cookies";
import { makeNonce, READER_PAGE_RE, readerCsp } from "@/lib/reader/csp";
import { catalogueCsp } from "@/lib/page-csp";
import { LIBRARY_SORT_COOKIE, parseLibrarySortPreference } from "@/lib/library/sort-preference";

/**
 * A request on a name that is not Durtal's is refused first, so a page that
 * points its own name at the Mac (DNS rebinding) reaches nothing (task 0608).
 * Only the build's own files skip that check: a GET or HEAD under /_next/,
 * which loads on any name. Next.js runs a server action, or a form posted
 * without JavaScript, on any path, /_next/ included, so anything else there is
 * checked like a page.
 *
 * An address with a broken percent code (/library/%ff) cannot be matched to a
 * page, and Next.js answers it with a bare 500 (SLN-898). An API route or a
 * build file answers 400; a page shows its not-found view, with the broken
 * part read as plain text.
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
 * Every page gets a Content-Security-Policy with a fresh nonce: the reader's
 * own, or the catalogue's (SLN-1240). A file of public/ gets none: the
 * service worker would take it as its own and could no longer fetch a map
 * tile. A reader page's durtal-device cookie is not made here: two reader
 * pages opened at once would make two (SLN-668); the reader asks for one
 * under a lock instead (src/lib/reader/device-handshake.ts).
 */
export function proxy(request: NextRequest) {
  const readable = readableAddress(request.nextUrl);
  if (readable && /^\/(api|_next)\//.test(request.nextUrl.pathname))
    return NextResponse.json({ error: "The address has a broken percent code" }, { status: 400 });
  if (buildFile(request)) return;
  const misdirected = hostRefusal(request);
  if (misdirected) return misdirected;
  if (readable) return NextResponse.rewrite(readable);
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return crossOriginRefusal(request) ?? undefined;
  }
  if (PUBLIC_FILE_RE.test(request.nextUrl.pathname)) return;
  if (READER_PAGE_RE.test(request.nextUrl.pathname)) return withPolicy(request, readerCsp);
  return (request.method === "GET" && savedPreferences(request)) || withPolicy(request, catalogueCsp);
}

/** A file of public/ or one of the app's icons */
const PUBLIC_FILE_RE =
  /^\/(?:(?:fonts|icons|textures|vendor)\/|(?:sw\.js|offline-assets\.json|favicon\.ico|icon\.svg|apple-icon\.png|manifest\.webmanifest)$)/;

/** A list page opened without its saved page size or sort, sent to the address with them */
function savedPreferences(request: NextRequest) {
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
  return url.href !== request.nextUrl.href ? NextResponse.redirect(url) : null;
}

/** A script, style, font, image or hot reload of the build, read on any name */
function buildFile(request: NextRequest) {
  return (
    request.nextUrl.pathname.startsWith("/_next/") && (request.method === "GET" || request.method === "HEAD")
  );
}

/**
 * The address with each path segment that does not decode escaped as text
 * ("%ff" becomes "%25ff"), or null when the whole path decodes
 */
function readableAddress(url: NextRequest["nextUrl"]) {
  try {
    decodeURIComponent(url.pathname);
    return null;
  } catch {
    const readable = url.clone();
    readable.pathname = url.pathname
      .split("/")
      .map((segment) => (decodes(segment) ? segment : segment.replaceAll("%", "%25")))
      .join("/");
    return readable;
  }
}

function decodes(segment: string) {
  try {
    decodeURIComponent(segment);
    return true;
  } catch {
    return false;
  }
}

/** A page's policy on the request (Next.js puts its nonce on its own scripts) and on the answer */
function withPolicy(request: NextRequest, policy: typeof readerCsp) {
  const nonce = makeNonce();
  const csp = policy(nonce, {
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
  // Every path. A path with a dot is a page too: the catch-all not-found page
  // answers it and runs any server action posted to it, so the host guard has
  // to see it (task 0608). So does /_next/: a matcher can't tell a GET from a
  // POST, so the build's files pass in the proxy (buildFile)
  matcher: ["/((?!api/|_next/).*)", "/api/:path*", "/ebooks/:path*", "/_next/:path*"],
};
