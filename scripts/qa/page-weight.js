/**
 * Page weight check: requests each main route and prints the HTML bytes and
 * the server time (until the last byte of the streamed page). Exits with 1
 * when a route is over its budget in page-weight.json.
 *
 *   node scripts/qa/page-weight.js [baseUrl]
 *
 * A path that ends in "/*" is a detail page: the first link under that path
 * on the list page is used ("/library/*" takes the first book on /library).
 * With no such link the route fails, unless it has an `ifNone` note: a
 * detail page that may have no record yet ("/reading/import/*" before the
 * first import) is then skipped with that note. Each route is requested once
 * before it is measured, so dev-server compilation is not counted.
 *
 * PAGE_WEIGHT_CONFIG names another budget file (the script's own test).
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

async function get(path) {
  const start = performance.now();
  const res = await fetch(baseUrl + path, {
    headers: { "accept-encoding": "identity" },
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

async function resolve(route) {
  if (!route.path.endsWith("/*")) return route.path;
  const list = route.path.slice(0, -2);
  const { body } = await get(list);
  const skip = new Set(route.skip ?? []);
  const pattern = new RegExp(`href="${list}/([^"/?#]+)"`, "g");
  for (const [, slug] of body.matchAll(pattern)) {
    if (!skip.has(slug)) return `${list}/${slug}`;
  }
  return null;
}

let failed = 0;
let skipped = 0;
for (const route of config.routes) {
  let line;
  try {
    const path = await resolve(route);
    if (!path && route.ifNone) {
      line = `skip  ${route.path.padEnd(40)} skipped: ${route.ifNone} (no link on ${route.path.slice(0, -2)})`;
      skipped++;
    } else if (!path) {
      line = `FAIL  ${route.path.padEnd(40)} no link found on ${route.path.slice(0, -2)}`;
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
