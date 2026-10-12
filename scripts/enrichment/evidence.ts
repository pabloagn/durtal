/**
 * The evidence store's CLI (SLN-468). Plans by default, on a read-only
 * session that a probe proves first; `--apply --backup FILE` writes, with a
 * pg_dump from the last hour, and every apply has a run id (R9).
 *
 * - `--outlets`: the registry seed's plan (added, changed, retired, before and
 *   after). With --apply it writes the seed version.
 * - `--propose-outlets`: publishers and translators with a website, and the
 *   original languages of owned books. Read-only.
 * - `--fetch URL --work ID` (or `--edition ID`): the outlet, its policy, the
 *   robots.txt decision and whether the URL is stored. With --apply it fetches
 *   and stores the page.
 * - `--undo RUN_ID`: deletes the run's evidence rows that no claim cites and
 *   lists the ones it keeps; their objects stay until --purge.
 * - `--costs`: this month's ledger per provider and operation, and open
 *   reservations.
 * - `--purge`: lists evidence objects no row names (the retention waits for
 *   Pablo's decision, so it deletes nothing).
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/enrichment/evidence.ts \
 *     [--outlets | --propose-outlets | --fetch URL (--work ID | --edition ID) [--refresh] | --undo RUN_ID | --costs | --purge]
 *     [--apply --backup FILE] [--report FILE] [--env-dir DIR]
 */
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";

const { values } = parseArgs({
  options: {
    outlets: { type: "boolean", default: false },
    "propose-outlets": { type: "boolean", default: false },
    fetch: { type: "string" },
    work: { type: "string" },
    edition: { type: "string" },
    refresh: { type: "boolean", default: false },
    undo: { type: "string" },
    costs: { type: "boolean", default: false },
    purge: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    backup: { type: "string" },
    report: { type: "string", default: "tmp/evidence-report.md" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
dotenv.config({
  path: [resolve(values["env-dir"]!, ".env.local"), resolve(values["env-dir"]!, ".env")],
  quiet: true,
});
const url = process.env.PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

// Imported after the environment loads: the S3 client and the env schema read it
const postgres = (await import("postgres")).default;
const { drizzle } = await import("drizzle-orm/postgres-js");
const { withReadOnlyPlanningConnection } = await import("@/lib/enrichment/read-only-session");
const { recentBackup } = await import("@/lib/enrichment/backup");
const { loadOutlets, applyOutletSeed } = await import("@/lib/enrichment/outlet-registry");
const { outletForUrl, planOutletSeed } = await import("@/lib/enrichment/outlets");
const { OUTLET_SEED, OUTLET_SEED_VERSION } = await import("@/lib/enrichment/outlets-seed");
const { proposeOutlets, costsReport, evidenceOrphans, EVIDENCE_RETENTION_DAYS } = await import("@/lib/enrichment/evidence-runs");
const { findStoredPage, storeEvidencePage, undoEvidenceRun } = await import("@/lib/enrichment/evidence-store");
const { createPageFetcher } = await import("@/lib/net/safe-fetch-page");
const { mainTextExtractor } = await import("@/lib/enrichment/extract");
const { bucketEvidenceObjects } = await import("@/lib/s3/evidence-objects");
type Db = import("@/lib/catalogue/work-store").Db;

const writes = values.apply || Boolean(values.undo);
if (values.apply && !recentBackup(values.backup))
  throw new Error("--apply needs --backup FILE: a pg_dump custom-format backup taken in the last hour");
const session = writes ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const runId = randomUUID();
const lines: string[] = [];
const say = (line = "") => lines.push(line);

const run = async (database: Db) => {

  if (values.outlets) {
    const plan = planOutletSeed(await loadOutlets(database), OUTLET_SEED);
    say(`# Outlet registry, seed version ${OUTLET_SEED_VERSION}${values.apply ? ` (applied, run ${runId})` : " (plan)"}`);
    say();
    say(`## Added (${plan.added.length})`);
    for (const o of plan.added) say(`- ${o.key}: ${o.name}, ${o.domains.join(", ")}, ${o.kind}, weight ${o.weight}, ${o.fetchPolicy}${o.termsNote ? ` (${o.termsNote})` : ""}`);
    say();
    say(`## Changed (${plan.changed.length})`);
    for (const { before, after } of plan.changed) say(`- ${after.key}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    say();
    say(`## Retired (${plan.retired.length})`);
    for (const o of plan.retired) say(`- ${o.key}: ${o.name}`);
    if (values.apply) await applyOutletSeed(database, OUTLET_SEED, OUTLET_SEED_VERSION);
  } else if (values["propose-outlets"]) {
    const { publishers, translators, languages } = await proposeOutlets(database);
    say("# Outlet proposals (read-only)");
    say();
    say(`## Publishers with a website, by owned books (${publishers.length})`);
    for (const p of publishers) say(`- ${p.name}: ${p.website} (${p.books})`);
    say();
    say(`## Translators with a website, by owned editions (${translators.length})`);
    for (const t of translators) say(`- ${t.name}: ${t.website} (${t.editions})`);
    say();
    say("## Original languages of owned books");
    say();
    say("Unreliable: most owned books say en, translations included, so this count does not show the press to read.");
    say();
    for (const l of languages) say(`- ${l.language}: ${l.books}`);
  } else if (values.fetch) {
    if (!values.work === !values.edition) throw new Error("--fetch needs --work ID or --edition ID");
    const owner = values.work ? { kind: "book" as const, workId: values.work } : { kind: "edition" as const, editionId: values.edition! };
    const outlets = await loadOutlets(database);
    const outlet = outletForUrl(values.fetch, outlets);
    const fetcher = createPageFetcher({ outletFor: (u) => outletForUrl(u, outlets) });
    say(`# Evidence fetch${values.apply ? ` (applied, run ${runId})` : " (plan)"}`);
    say();
    say(`- URL: ${values.fetch}`);
    say(`- Outlet: ${outlet ? `${outlet.key} (${outlet.name}), policy ${outlet.fetchPolicy}` : "none: the URL is off the registry"}`);
    if (outlet?.fetchPolicy === "fetch") {
      const robots = await fetcher.readRobots(values.fetch);
      say(
        `- robots.txt: ${robots.readable ? `HTTP ${robots.status}, ${robots.allowed ? "allowed" : "disallowed"} (${robots.rule ?? "no rule matched"}), crawl delay ${robots.crawlDelay ?? "none"}` : "unreachable: the host is not fetched in this run"}`,
      );
    }
    const stored = await findStoredPage(database, values.fetch);
    say(`- Stored already: ${stored ? `yes, row ${stored.id} of ${stored.retrievedAt.toISOString()}: apply reuses it without a fetch${values.refresh ? " (unless --refresh)" : ""}` : "no"}`);
    if (values.apply) {
      const { record, fetched, created } = await storeEvidencePage({
        database,
        owner,
        url: values.fetch,
        runId,
        refresh: values.refresh,
        fetchPage: fetcher.fetchPage,
        extractor: mainTextExtractor,
        objects: bucketEvidenceObjects,
        outletName: (key) => outlets.find((o) => o.key === key)?.name ?? key,
      });
      const payload = record.payload as { textSha256: string; rawSha256?: string; robots?: { rule: string | null } };
      say(`- Stored: ${created ? "a new row" : "the owner's row already held it"}, ${fetched ? "fetched" : "reused without a fetch"}`);
      say(`- Row ${record.id}; text ${payload.textSha256}${payload.rawSha256 ? `; raw ${payload.rawSha256}` : ""}`);
      if (payload.robots) say(`- robots.txt rule: ${payload.robots.rule ?? "none matched (allowed)"}`);
    } else if (outlet?.fetchPolicy === "fetch") {
      say("- Apply fetches the page, stores its gzipped copy and its main text under their hashes, and writes one source record for the owner.");
    }
  } else if (values.undo) {
    const { deleted, kept } = await undoEvidenceRun(database, values.undo);
    say(`# Undo of run ${values.undo}`);
    say();
    say(`- Deleted ${deleted} evidence rows that no claim cites`);
    say(`- Kept ${kept.length} cited rows${kept.length ? `: ${kept.join(", ")}` : ""}`);
  } else if (values.costs) {
    const report = await costsReport(database);
    say(`# Costs, ${report.start.toISOString().slice(0, 10)} to ${report.end.toISOString().slice(0, 10)}`);
    say();
    for (const l of report.lines) say(`- ${l.provider} ${l.operation}: ${l.calls} calls, settled $${l.settled_usd.toFixed(4)}, reserved $${l.reserved_usd.toFixed(4)}`);
    say();
    say(`## Open reservations (${report.open.length})`);
    for (const o of report.open)
      say(`- ${o.id} ${o.provider} ${o.operation}: $${o.estimated_cost_usd.toFixed(4)}, ${o.age_minutes} min${o.age_minutes > 60 ? " (over an hour: still counted at its estimate)" : ""}`);
  } else if (values.purge) {
    const { scanned, orphans } = await evidenceOrphans(database);
    say("# Evidence purge (plan: nothing is deleted)");
    say();
    say(`Retention of ${EVIDENCE_RETENTION_DAYS} days waits for Pablo's decision, so only objects no row names are listed.`);
    say();
    say(`- Scanned ${scanned} objects older than a day; ${orphans.length} orphans`);
    for (const o of orphans) say(`- ${o.key} (${o.size} bytes, ${o.modified})`);
  } else {
    throw new Error("Choose one of --outlets, --propose-outlets, --fetch, --undo, --costs or --purge");
  }
  mkdirSync(dirname(values.report!), { recursive: true });
  writeFileSync(values.report!, lines.join("\n") + "\n");
  console.log(`Report written to ${values.report}`);
};
try {
  if (session) await run(drizzle(session) as unknown as Db);
  else await withReadOnlyPlanningConnection(url, run);
} finally {
  await session?.end();
}
