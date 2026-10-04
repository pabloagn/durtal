#!/usr/bin/env node
/**
 * Catalogue timing: requests each route twice (first and repeat) against a
 * preview started with --log-sql, and reports per request the server time,
 * the HTML size, how many queries the app sent, their summed time and the
 * slowest one. With --explain CONTAINER it also runs EXPLAIN ANALYZE on the
 * slowest distinct queries in that preview's database.
 *
 *   python3 scripts/qa/preview-local.py --from-dump FILE --seed-large 2000 --log-sql /tmp/sql.jsonl
 *   node scripts/qa/catalogue-timing.mjs --base http://127.0.0.1:3410 --sql-log /tmp/sql.jsonl \
 *     [--explain durtal-preview-xxxx] [--json out.json] [route...]
 *
 * Each route is requested once with a throwaway query first, so a fresh next
 * dev compiles it before the timed requests. It sends GETs only, and refuses
 * any host but this computer and port 3100 (the live app). --explain replays
 * only reads (select, with), each inside a transaction that is rolled back,
 * and only in a container named durtal-preview-*.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const base = (option("--base") ?? "http://127.0.0.1:3410").replace(/\/$/, "");
const sqlLog = option("--sql-log");
const container = option("--explain");
const jsonOut = option("--json");
const ROUTES = [
  "/", "/library", "/library?q=the", "/authors",
  "/perfumes", "/perfumes?page=20", "/perfumes?q=Seed%20Perfume%201999", "/perfumes?favourite=1", "/perfumes/seed-perfume-1",
  "/films", "/films?page=20", "/films?q=Seed%20Film%201999", "/films?favourite=1", "/films/seed-film-1",
  "/paintings", "/paintings?page=20", "/paintings?q=Seed%20Painting%201999", "/paintings?favourite=1", "/paintings/seed-painting-1",
  "/authors/seed-person-1",
];
const routes = args.length ? args : ROUTES;
const target = URL.parse(base);
const refusal = !target
  ? `${base} is not a URL`
  : !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    ? `${target.hostname} is not this computer`
    : target.port === "3100"
      ? "port 3100 is the live app"
      : container && !/^durtal-preview-[0-9a-f]+$/.test(container)
        ? `${container} is not a preview container (durtal-preview-*)`
        : null;
if (refusal) {
  console.error(`Refused: ${refusal}`);
  process.exit(2);
}
if (!sqlLog || !existsSync(sqlLog)) {
  console.error("Pass --sql-log FILE: the file a preview started with --log-sql writes");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The complete lines written since a byte offset (names hold multi-byte characters) */
function newLines(offset) {
  const bytes = readFileSync(sqlLog).subarray(offset);
  const text = bytes.toString("utf8");
  const end = text.lastIndexOf("\n");
  if (end < 0) return { queries: [] };
  return { queries: text.slice(0, end).split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}
async function measure(path) {
  const offset = statSync(sqlLog).size;
  const started = performance.now();
  const res = await fetch(base + path, { redirect: "manual" });
  const html = await res.text();
  const ms = performance.now() - started;
  await sleep(300); // the bridge appends after each query
  const { queries } = newLines(offset);
  const slowest = queries.reduce((a, q) => (q.ms > (a?.ms ?? -1) ? q : a), null);
  return {
    status: res.status, ms: Math.round(ms), kb: Math.round(Buffer.byteLength(html) / 1024),
    queries: queries.length, sqlMs: Math.round(queries.reduce((n, q) => n + q.ms, 0)),
    rows: queries.reduce((n, q) => n + (q.rows ?? 0), 0), slowest,
    all: queries,
  };
}

const results = [];
for (const path of routes) {
  const route = path.split("?")[0];
  await fetch(`${base}${route}${route.includes("?") ? "&" : "?"}timing-warm-up=1`, { signal: AbortSignal.timeout(180000) }).catch(() => {});
  const first = await measure(path);
  const repeat = await measure(path);
  results.push({ path, first, repeat });
  const line = (r) => `${String(r.status).padStart(3)} ${String(r.ms).padStart(5)} ms ${String(r.kb).padStart(4)} KB ${String(r.queries).padStart(3)} q ${String(r.sqlMs).padStart(5)} ms sql`;
  console.log(`${path.padEnd(44)} first ${line(first)} | repeat ${line(repeat)} | slowest ${first.slowest ? `${first.slowest.ms} ms, ${first.slowest.rows} rows` : "-"}`);
}

// The same query text sent many times in one request is the N+1 sign
console.log("\nRepeated query texts in one request (first request):");
for (const { path, first } of results) {
  const counts = new Map();
  for (const q of first.all) counts.set(q.sql, (counts.get(q.sql) ?? 0) + 1);
  const repeated = [...counts].filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]);
  for (const [sql, n] of repeated.slice(0, 3)) console.log(`  ${path}: ${n}× ${sql.replace(/\s+/g, " ").slice(0, 110)}`);
}

if (container) {
  const distinct = new Map();
  // Reads only: a logged write is never run again
  const isRead = (sql) => /^\s*(select|with)\b/i.test(sql);
  for (const { first } of results) for (const q of first.all.filter((q) => isRead(q.sql))) {
    const known = distinct.get(q.sql);
    if (!known || q.ms > known.ms) distinct.set(q.sql, q);
  }
  const slowest = [...distinct.values()].sort((a, b) => b.ms - a.ms).slice(0, 8);
  console.log("\nQuery plans of the slowest distinct queries:");
  for (const [n, q] of slowest.entries()) {
    const literal = (v) => (v === null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
    // In a transaction that is rolled back: even a write hidden in a with clause leaves nothing
    const sql = `begin;\nprepare timing_q as ${q.sql};\nexplain (analyze, buffers, costs off) execute timing_q${q.params?.length ? `(${q.params.map(literal).join(", ")})` : ""};\nrollback;\ndeallocate timing_q;`;
    let plan;
    try {
      plan = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-A", "-t", "-U", "durtal_preview", "-d", "durtal_preview"], { input: sql, encoding: "utf8" });
    } catch (error) {
      plan = `(plan failed: ${String(error.stderr ?? error.message).split("\n")[0]})`;
    }
    console.log(`\n#${n + 1} ${q.ms} ms, ${q.rows} rows: ${q.sql.replace(/\s+/g, " ").slice(0, 160)}`);
    for (const l of plan.split("\n").filter((l) => /Seq Scan|Execution Time|Planning Time|Nested Loop|Sort Method|rows=/.test(l)).slice(0, 14)) console.log(`   ${l.trim()}`);
  }
}

if (jsonOut)
  writeFileSync(jsonOut, JSON.stringify(results.map(({ path, first, repeat }) => ({
    path, first: { ...first, all: undefined }, repeat: { ...repeat, all: undefined },
  })), null, 2));
