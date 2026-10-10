/**
 * The book enrichment worker (SLN-464). Works the queued jobs of its kinds
 * by hand on the Mac; the logic is in src/lib/enrichment/worker.ts.
 *
 * Modes:
 * - default (plan): a read-only session. Fetches the jobs' answers into the
 *   cache and reports what an apply would do. Writes nothing.
 * - `--apply --backup FILE`: releases the holds of its kinds, runs each
 *   stage's steps, then works its jobs one at a time. Refuses without a
 *   pg_dump custom-format backup written in the last hour.
 * - `--undo RUN_ID`: lists a run's applies; with `--apply --backup FILE`,
 *   undoes them, newest first, and each stage's own writes.
 * - `--enqueue KIND --scope owned|on_order|wanted|all`: queues one job per book
 *   of the scope (or of `--only`); counts only, unless `--apply --backup`.
 * - `--enable-identity-rules --dimensions KEY,… --approval URL`: turns on
 *   those identity dimensions' exact-match rules, with `--apply --backup`.
 * - `--disable-identity-rules [--dimensions KEY,…]`: turns them off at once.
 * - `--determinism-check N`: sends N model requests of the cache again and
 *   compares the answers (SLN-469). Paid: only with `--apply --backup`, and
 *   it writes only cost rows.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/enrichment/worker.ts \
 *     [--kinds identity] [--apply --backup FILE] [--undo RUN_ID]
 *     [--enqueue KIND --scope owned|on_order|wanted|all]
 *     [--enable-identity-rules --dimensions KEY,… --approval URL]
 *     [--disable-identity-rules [--dimensions KEY,…]] [--determinism-check N] [--only SLUG,…]
 *     [--limit N] [--report FILE] [--cache FILE] [--pace MS] [--env-dir DIR]
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { writeFileSync } from "node:fs";
import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";
import { JOB_KINDS, type EnrichmentJobKind } from "@/lib/enrichment/model";
import { ENRICHMENT_SCOPES, type EnrichmentScope } from "@/lib/enrichment/queue";
import { recentBackup } from "@/lib/enrichment/backup";
import { SourceCache } from "@/lib/enrichment/source-cache";
import { HEARTBEAT_MS, enqueueScope, runWorker, undoRun } from "@/lib/enrichment/worker";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { disableIdentityRules, enableIdentityRules } from "@/lib/enrichment/identity-rules";
import { determinismCheck } from "@/lib/enrichment/research/extract-stage";
import { anthropicModel } from "@/lib/enrichment/research/model";

const { values } = parseArgs({
  options: {
    kinds: { type: "string", default: "identity" },
    apply: { type: "boolean", default: false },
    backup: { type: "string" },
    undo: { type: "string" },
    enqueue: { type: "string" },
    scope: { type: "string" },
    "enable-identity-rules": { type: "boolean", default: false },
    "disable-identity-rules": { type: "boolean", default: false },
    "determinism-check": { type: "string" },
    dimensions: { type: "string" },
    approval: { type: "string" },
    only: { type: "string" },
    limit: { type: "string" },
    report: { type: "string", default: "enrichment-report.md" },
    cache: { type: "string", default: "enrichment-sources.json" },
    pace: { type: "string", default: "1100" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
dotenv.config({
  path: [resolve(values["env-dir"]!, ".env.local"), resolve(values["env-dir"]!, ".env")],
  quiet: true,
});
const url = process.env.PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const kind = (value: string) => {
  if (!(JOB_KINDS as readonly string[]).includes(value)) throw new Error(`Unknown job kind: ${value}`);
  return value as EnrichmentJobKind;
};
const names = (value: string | undefined) => value?.split(",").map((s) => s.trim()).filter(Boolean);
const only = names(values.only);
// Turning rules off only stops writes: it writes at once, with no backup
const disabling = values["disable-identity-rules"];
if (values.apply && !recentBackup(values.backup))
  throw new Error("--apply needs --backup: a pg_dump custom-format file written in the last hour");

// Outside --apply, the session itself refuses writes
const writes = values.apply || disabling;
const client = writes ? postgres(url, { max: 1, onnotice: () => {} }) : null;
// An apply's heartbeat renews job leases on its own connection
const beatClient = values.apply ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const run = async (conn: Db) => {
  let lines: string[];
  if (disabling) {
    lines = await disableIdentityRules(conn, { dimensions: names(values.dimensions) });
  } else if (values["enable-identity-rules"]) {
    lines = await enableIdentityRules(conn, { dimensions: names(values.dimensions) ?? [], approvalUrl: values.approval, apply: values.apply });
  } else if (values["determinism-check"]) {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!values.apply || !key) throw new Error("--determinism-check makes paid calls: it needs --apply --backup and ANTHROPIC_API_KEY");
    const runId = randomUUID();
    const check = await determinismCheck(conn, { n: Number(values["determinism-check"]), cache: SourceCache.load(values.cache!), runId, model: anthropicModel(key) });
    lines = [`# Determinism check ${runId}`, "", ...check];
  } else if (values.undo) {
    lines = (await undoRun(conn, { runId: values.undo, apply: values.apply })).lines;
  } else if (values.enqueue) {
    if (!(ENRICHMENT_SCOPES as readonly string[]).includes(values.scope ?? "")) throw new Error(`--enqueue needs --scope ${ENRICHMENT_SCOPES.join("|")}`);
    lines = (await enqueueScope(conn, { kind: kind(values.enqueue), scope: values.scope as EnrichmentScope, only, apply: values.apply })).lines;
  } else {
    const runId = randomUUID();
    const result = await runWorker(conn, {
      runId,
      // The run id makes the worker unique, also when a process id comes back
      worker: `${hostname()}:${process.pid}:${runId}`,
      kinds: values.kinds!.split(",").map((k) => kind(k.trim())),
      apply: values.apply,
      cache: SourceCache.load(values.cache!),
      pace: Number(values.pace),
      contact: process.env.ENRICHMENT_CONTACT?.trim() || null,
      only,
      limit: values.limit ? Number(values.limit) : undefined,
      heartbeat: beatClient ? { conn: drizzle(beatClient, { schema }) as unknown as Db, everyMs: HEARTBEAT_MS } : undefined,
    });
    lines = [`# Enrichment ${values.apply ? "run" : "plan"} ${runId}`, "", ...result.lines];
  }
  writeFileSync(values.report!, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
};
try {
  if (client) await run(drizzle(client, { schema }) as unknown as Db);
  else await withReadOnlyPlanningConnection(url, run);
} finally {
  // Both close, even when the first throws
  await Promise.allSettled([client?.end(), beatClient?.end()]);
}
