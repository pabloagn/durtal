/**
 * Page weight check: requests each main route and prints the HTML bytes and
 * the server time (until the last byte of the streamed page). Exits with 1
 * when a route is over its budget in page-weight.json.
 *
 *   node scripts/qa/page-weight.js [baseUrl]
 *
 * A path that ends in "/*" is a detail page: the first link under that path
 * on the list page is used ("/library/*" takes the first book on /library;
 * `skip` leaves out slugs such as "new"). `list` reads the links from another
 * page, and `pick: "most"` takes the record linked most often there: the
 * book with the most quotes on /reading/notes (SLN-510). A path that ends in
 * "=*" takes that query value from the first link carrying it, on `list`
 * (default: the path without its query): "/ebooks/highlights?ebook=*" is one
 * book's marks, through its "All N in this book" link. With no such link
 * the route fails, unless it has an `ifNone` note: a detail page that may
 * have no record yet ("/reading/import/*" before the first import) is then
 * skipped with that note. A link's query and fragment are left out
 * ("/reader/<id>?file=…" measures "/reader/<id>"). Each route is requested once
 * before it is measured, so dev-server compilation is not counted.
 *
 * PAGE_WEIGHT_CONFIG names another budget file (the script's own test).
 * page-weight-heavy.json is the worst-case book page, on a preview started
 * with --seed-heavy-book (SLN-1163). It runs apart from the gated routes
 * until its editions and notes are slimmed (SLN-1132, SLN-1079); the gated
 * book rows skip it, so one preview serves both.
 *
 * Every front-end change must pass this before it is called done, like the
 * alignment audit.
 */
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(process.env.PAGE_WEIGHT_CONFIG ?? new URL("./page-weight.json", import.meta.url), "utf8"),
);
const baseUrl = (process.argv[2] ?? config.baseUrl).replace(/\/$/, "");
const TIMEOUT_MS = 120_000;
// A browser that has opened the reader before: without the cookie a reader
// page is only the step that makes this device's id (SLN-668), not the reader
const DEVICE_COOKIE = "durtal-device=00000000-0000-4000-8000-0000000000aa";

async function get(path) {
  const start = performance.now();
  const res = await fetch(baseUrl + path, {
    headers: { "accept-encoding": "identity", cookie: DEVICE_COOKIE },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text();
  return {
    status: res.status,
    body,
    bytes: Buffer.byteLength(body),
    ms: performance.now() - start,
  };
}

/** The page a "/*" or "=*" row reads its links from. */
function listOf(route) {
  return route.list ?? (route.path.endsWith("/*") ? route.path.slice(0, -2) : route.path.split("?")[0]);
}

async function resolve(route) {
  if (!route.path.endsWith("/*") && !route.path.endsWith("=*")) return route.path;
  const prefix = route.path.slice(0, -1);
  const { body } = await get(listOf(route));
  const skip = new Set(route.skip ?? []);
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The record's id or slug, before any query or fragment: reader links carry
  // ?file=…&returnTo=… and are measured without them (SLN-688)
  const pattern = new RegExp(`href="${escaped}([^"/?#&]+)(?:[?#&][^"]*)?"`, "g");
  const slugs = [...body.matchAll(pattern)].map(([, slug]) => slug).filter((slug) => !skip.has(slug));
  if (!slugs.length) return null;
  if (route.pick !== "most") return `${prefix}${slugs[0]}`;
  // The record linked most often; the first one linked wins a tie
  const counts = new Map();
  for (const slug of slugs) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  return `${prefix}${[...counts].sort((a, b) => b[1] - a[1])[0][0]}`;
}

let failed = 0;
let skipped = 0;
for (const route of config.routes) {
  let line;
  try {
    const path = await resolve(route);
    if (!path && route.ifNone) {
      line = `skip  ${route.path.padEnd(40)} skipped: ${route.ifNone} (no link on ${listOf(route)})`;
      skipped++;
    } else if (!path) {
      line = `FAIL  ${route.path.padEnd(40)} no link found on ${listOf(route)}`;
      failed++;
    } else {
      await get(path);
      const { status, bytes, ms } = await get(path);
      const kb = bytes / 1024;
      const over = status !== 200 || kb > route.maxKB || ms > route.maxMs;
      if (over) failed++;
      line = [
        over ? "FAIL" : "ok  ",
        path.padEnd(40),
        `${kb.toFixed(0).padStart(6)} / ${route.maxKB} KB`.padEnd(18),
        `${ms.toFixed(0).padStart(6)} / ${route.maxMs} ms`.padEnd(18),
        status === 200 ? "" : `HTTP ${status}`,
      ].join("  ");
    }
  } catch (err) {
    line = `FAIL  ${route.path.padEnd(40)} ${err.message}`;
    failed++;
  }
  console.log(line.trimEnd());
}

if (skipped) console.log(`\n${skipped} of ${config.routes.length} routes skipped: nothing to measure yet`);
if (failed) {
  console.error(
    `\n${failed} of ${config.routes.length} routes failed the budget`,
  );
  process.exit(1);
}
