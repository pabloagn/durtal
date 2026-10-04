import { NextResponse } from "next/server";

/**
 * Same-origin check for the API routes (task 0255).
 *
 * The app's own pages call many API routes from the browser (uploads,
 * comments, export, reader, venues, S3 reads), so a token cannot guard
 * them. This check stops a web page on another origin from calling them
 * through the browser: a cross-site upload, delete or export.
 *
 * Browsers say where a request comes from. `Sec-Fetch-Site` is sent by
 * every current browser; `Origin` is the fallback for older ones. A request
 * with neither header does not come from a web page (curl, the TUI, a
 * script) and passes: the token routes and the network bind guard those.
 */
export function crossOriginRefusal(req: Request): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site) {
    // "none": the user opened the URL directly (address bar, bookmark).
    if (site === "same-origin" || site === "none") return null;
    return refuse();
  }
  const origin = req.headers.get("origin");
  if (!origin) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return refuse();
  }
  return originHost === req.headers.get("host") ? null : refuse();
}

function refuse() {
  return NextResponse.json(
    { error: "Refused: the request comes from another site" },
    { status: 403 },
  );
}
