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
 * - `--enqueue KIND --scope owned|on_order|wanted`: queues one job per book
 *   of the scope (or of `--only`); counts only, unless `--apply --backup`.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/enrichment/worker.ts \
 *     [--kinds identity] [--apply --backup FILE] [--undo RUN_ID]
 *     [--enqueue KIND --scope owned|on_order|wanted] [--only SLUG,…]
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
import { assertReadOnly, enqueueScope, runWorker, undoRun } from "@/lib/enrichment/worker";

const { values } = parseArgs({
  options: {
    kinds: { type: "string", default: "identity" },
    apply: { type: "boolean", default: false },
    backup: { type: "string" },
    undo: { type: "string" },
    enqueue: { type: "string" },
    scope: { type: "string" },
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
const only = values.only?.split(",").map((s) => s.trim()).filter(Boolean);
if (values.apply && !recentBackup(values.backup))
  throw new Error("--apply needs --backup: a pg_dump custom-format file written in the last hour");

// Outside --apply, the session itself refuses writes
const client = postgres(url, { max: 1, onnotice: () => {}, connection: values.apply ? {} : { default_transaction_read_only: true } });
const conn = drizzle(client, { schema }) as unknown as Db;
try {
  if (!values.apply) await assertReadOnly(conn);
  let lines: string[];
  if (values.undo) {
    lines = (await undoRun(conn, { runId: values.undo, apply: values.apply })).lines;
  } else if (values.enqueue) {
    if (!(ENRICHMENT_SCOPES as readonly string[]).includes(values.scope ?? "")) throw new Error(`--enqueue needs --scope ${ENRICHMENT_SCOPES.join("|")}`);
    lines = (await enqueueScope(conn, { kind: kind(values.enqueue), scope: values.scope as EnrichmentScope, only, apply: values.apply })).lines;
  } else {
    const runId = randomUUID();
    const result = await runWorker(conn, {
      runId,
      worker: `${hostname()}:${process.pid}`,
      kinds: values.kinds!.split(",").map((k) => kind(k.trim())),
      apply: values.apply,
      cache: SourceCache.load(values.cache!),
      pace: Number(values.pace),
      contact: process.env.ENRICHMENT_CONTACT?.trim() || null,
      only,
      limit: values.limit ? Number(values.limit) : undefined,
    });
    lines = [`# Enrichment ${values.apply ? "run" : "plan"} ${runId}`, "", ...result.lines];
  }
  writeFileSync(values.report!, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
} finally {
  await client.end();
}
