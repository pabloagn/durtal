/**
 * Book metadata enrichment (SLN-414). Reads each edition's ISBN record from
 * ISBNdb and Open Library and fills only empty fields: description, page
 * count, publication year and binding, and a work's description when it has
 * none. Language is never empty (it defaults to 'en'), so a run only reports
 * a language that differs. Values that differ are reported, never changed. ISBNs,
 * publishers, imprints and every image are never written (the rules:
 * `src/lib/books/enrichment.ts`).
 *
 * Modes:
 * - `--assess`: holes per field and works whose original year looks like an
 *   edition year. Read-only; no source is called.
 * - default (plan): calls the sources (paced, every answer cached in --cache,
 *   so a second plan and the apply read the same data), writes the plan to
 *   --report, writes nothing: the session is read-only, and a probe proves
 *   the database refuses a write before anything runs. The first quota or
 *   rate-limit refusal stops the run; the report says where.
 * - `--apply --backup FILE`: writes the plan in one transaction. The values
 *   it wrote go to the undo file, which is created before the write (a
 *   missing folder or an existing file stops the run first) and filled right
 *   after the commit; it is named after the run. Refuses to run without a pg_dump custom-format backup
 *   (starts with PGDMP) written in the last hour. Check the ISBNdb plan's
 *   quota first.
 * - `--undo FILE`: clears what that run wrote, where it still holds the run's
 *   value, and removes its provenance.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/books/enrich.ts \
 *     [--assess] [--apply --backup FILE] [--undo FILE] [--limit N] [--only ID,ID]
 *     [--report FILE] [--cache FILE] [--undo-file FILE] [--pace MS] [--env-dir DIR]
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import postgres from "postgres";
import type { MatchCandidate } from "@/lib/match/plan";
import { cleanRecord, isbndbRecord } from "@/lib/match/source";
import type { IsbndbBook } from "@/lib/api/isbndb";
import { serverEnv } from "@/lib/env";
import {
  BOOK_SOURCES,
  BOOK_SOURCE_LABEL,
  planEdition,
  suspectOriginalYear,
  type BookSource,
  type EditionPlan,
  type EditionRow,
} from "@/lib/books/enrichment";
import {
  applyEditionPlan,
  assessBookMetadata,
  loadEnrichableEditions,
  undoEnrichment,
  type EnrichmentUndo,
  type Written,
} from "@/lib/books/enrichment-store";
import { completeUndoFile, releaseUndoFile, reserveUndoFile } from "@/lib/books/undo-file";

const { values } = parseArgs({
  options: {
    assess: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    backup: { type: "string" },
    undo: { type: "string" },
    limit: { type: "string" },
    only: { type: "string" },
    report: { type: "string", default: "book-enrichment.md" },
    cache: { type: "string", default: "book-sources.json" },
    "undo-file": { type: "string" },
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
// Outside --apply and --undo, the session itself refuses writes
const sql = postgres(url, {
  max: 1,
  onnotice: () => {},
  connection: values.apply || values.undo ? {} : { default_transaction_read_only: true },
});

if (values.undo) {
  const undo: EnrichmentUndo = JSON.parse(readFileSync(values.undo, "utf8"));
  const restored = await sql.begin((tx) => undoEnrichment(tx as unknown as postgres.Sql, undo));
  console.log(`Cleared ${restored} of ${undo.written.length} values of run ${undo.runId}`);
  await sql.end();
  process.exit(0);
}

if (values.assess) {
  // Read-only: the transaction refuses any write
  const { counts, suspectYears } = await sql.begin("read only", (tx) => assessBookMetadata(tx as unknown as postgres.Sql));
  const lines = [
    "# Book metadata: assessment",
    "",
    "| Holes | Count |",
    "|---|---|",
    ...Object.entries(counts).map(([k, v]) => `| ${k.replaceAll("_", " ")} | ${v} |`),
    "",
    `## Works whose original year looks like an edition year (${suspectYears.length})`,
    "",
    ...suspectYears
      .map((w) => ({ w, why: suspectOriginalYear(w.original_year, w.years) }))
      .filter(({ why }) => why)
      .map(({ w, why }) => `- ${w.title}: ${why} (editions: ${w.years.join(", ")})`),
  ];
  writeFileSync(values.report!, lines.join("\n") + "\n");
  console.log(`Assessment written to ${values.report}`);
  await sql.end();
  process.exit(0);
}

/** A pg_dump custom-format file (it starts with PGDMP) written in the last hour */
function recentBackup(file: string | undefined) {
  if (!file || !existsSync(file)) return false;
  const head = Buffer.alloc(5);
  const fd = openSync(file, "r");
  try {
    readSync(fd, head, 0, 5, 0);
  } finally {
    closeSync(fd);
  }
  return head.toString("latin1") === "PGDMP" && Date.now() - statSync(file).mtimeMs < 60 * 60_000;
}
if (values.apply && !recentBackup(values.backup))
  throw new Error("--apply needs --backup FILE: a pg_dump custom-format backup taken in the last hour");

// ── Sources, paced and cached ───────────────────────────────────────────────
type Cache = Record<string, Partial<Record<BookSource, MatchCandidate | null>>>;
const cache: Cache = existsSync(values.cache!) ? JSON.parse(readFileSync(values.cache!, "utf8")) : {};
const pace = Number(values.pace);
let lastCall = 0;
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastCall + pace - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  return fn();
}

/** A source's quota or rate limit refused a call: the run stops there */
class QuotaStop extends Error {}

async function fromIsbndb(isbn: string): Promise<MatchCandidate | null> {
  // serverEnv also reads the old ISBNDN_API_KEY spelling
  const key = serverEnv().ISBNDB_API_KEY?.trim();
  if (!key) throw new QuotaStop("ISBNDB_API_KEY is not set");
  const res = await paced(() =>
    fetch(`https://api2.isbndb.com/book/${encodeURIComponent(isbn)}`, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(10_000),
    }),
  );
  if (res.status === 404) return null;
  // Read before the cache: a refusal is never stored as "no record"
  if (res.status === 429 || res.status === 403)
    throw new QuotaStop(`ISBNdb refused a call (HTTP ${res.status}): over the plan's rate or daily limit`);
  if (!res.ok) throw new Error(`ISBNdb: HTTP ${res.status}`);
  const book = ((await res.json()) as { book?: IsbndbBook }).book;
  return book ? isbndbRecord(book) : null;
}

async function fromOpenLibrary(isbn: string): Promise<MatchCandidate | null> {
  const res = await paced(() =>
    fetch(`https://openlibrary.org/isbn/${isbn}.json`, {
      headers: { "User-Agent": "Durtal book enrichment (personal catalogue)" },
      signal: AbortSignal.timeout(10_000),
    }),
  );
  if (res.status === 404) return null;
  if (res.status === 429) throw new QuotaStop("Open Library refused a call (HTTP 429): over its rate limit");
  if (!res.ok) throw new Error(`Open Library: HTTP ${res.status}`);
  const d = await res.json();
  return cleanRecord({
    title: d.title,
    subtitle: d.subtitle,
    publisher: d.publishers?.[0],
    isbn13: d.isbn_13?.[0],
    isbn10: d.isbn_10?.[0],
    year: d.publish_date,
    pages: d.number_of_pages,
    language: String(d.languages?.[0]?.key ?? "").split("/").pop(),
    binding: d.physical_format,
    description: typeof d.description === "string" ? d.description : d.description?.value,
  });
}

async function records(isbn: string) {
  const cached = (cache[isbn] ??= {});
  for (const source of BOOK_SOURCES) {
    if (source in cached) continue;
    try {
      cached[source] = source === "isbndb" ? await fromIsbndb(isbn) : await fromOpenLibrary(isbn);
    } catch (error) {
      if (error instanceof QuotaStop) throw error;
      // Not cached: the next run asks again
      console.warn(`${BOOK_SOURCE_LABEL[source]} ${isbn}: ${error instanceof Error ? error.message : "failed"}`);
    }
    writeFileSync(values.cache!, JSON.stringify(cache, null, 2));
  }
  return cached;
}

// ── Plan, and apply when asked ──────────────────────────────────────────────
const runId = randomUUID();
// Named after the run: an undo file of another run is never overwritten
const undoFile = values["undo-file"] ?? `book-enrichment-undo-${runId}.json`;
const retrievedAt = new Date();
const plans: { row: EditionRow; plan: EditionPlan }[] = [];
const written: Written[] = [];

/**
 * The guard: a write in this read-only transaction must fail with
 * "read-only transaction" (25006). A probe that changes no row checks it.
 */
async function assertReadOnly(tx: postgres.TransactionSql) {
  const refused = await tx
    .savepoint((sp) => sp`update works set updated_at = updated_at where false`)
    .then(
      () => false,
      (error: { code?: string }) => error.code === "25006",
    );
  if (!refused) throw new Error("The database accepted a write in a read-only transaction; nothing ran");
}

// The editions, read in a short read-only transaction
const rows = await sql.begin("read only", async (tx) => {
  await assertReadOnly(tx);
  return loadEnrichableEditions(tx as unknown as postgres.Sql, {
    limit: values.limit ? Number(values.limit) : undefined,
    ids: values.only?.split(",").filter(Boolean),
  });
});

// The sources, outside any transaction; a quota refusal stops the run
let stopped: string | null = null;
for (const row of rows) {
  const isbn = row.isbn13 ?? row.isbn10!;
  try {
    plans.push({ row, plan: planEdition(row, await records(isbn)) });
  } catch (error) {
    if (!(error instanceof QuotaStop)) throw error;
    stopped = error.message;
    console.warn(`Stopped after ${plans.length} of ${rows.length} editions: ${stopped}`);
    break;
  }
}
// An apply never writes a partial plan
if (values.apply && stopped) throw new Error(`Nothing written: ${stopped}`);

if (values.apply) {
  // The undo file exists before the write: a bad path stops the run here
  reserveUndoFile(undoFile, runId);
  try {
    await sql.begin("read write", async (tx) => {
      for (const { row, plan } of plans)
        if (!plan.skipped && (plan.fills.length || plan.workFills.length))
          written.push(
            ...(await applyEditionPlan(tx as unknown as postgres.Sql, plan, {
              runId,
              retrievedAt,
              isbn: row.isbn13 ?? row.isbn10!,
            })),
          );
    });
  } catch (error) {
    releaseUndoFile(undoFile);
    throw error;
  }
}
// The run is committed: its undo file comes first, before the report
if (values.apply) {
  completeUndoFile(undoFile, { runId, written });
  console.log(`Applied run ${runId}: ${written.length} values; undo file ${undoFile}`);
}

// ── Report ──────────────────────────────────────────────────────────────────
const fmt = (v: unknown) => {
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};
const filled = plans.filter((p) => p.plan.fills.length || p.plan.workFills.length);
const lines = [
  `# Book metadata: ${values.apply ? `applied (run ${runId})` : "plan (nothing written)"}`,
  "",
  ...(stopped ? [`**Stopped after ${plans.length} of ${rows.length} editions:** ${stopped}`, ""] : []),
  `${plans.length} editions read; ${filled.length} with fills; ${plans.filter((p) => p.plan.differs.length).length} with differences; ${plans.filter((p) => p.plan.held.length).length} with held fields.`,
  "",
];
for (const { row, plan } of plans) {
  if (!plan.fills.length && !plan.workFills.length && !plan.differs.length && !plan.held.length && !plan.skipped)
    continue;
  lines.push(`## ${row.title} (${row.isbn13 ?? row.isbn10})`, "");
  if (plan.skipped) lines.push(`- Skipped: ${plan.skipped}`);
  for (const [source, why] of Object.entries(plan.rejected)) lines.push(`- ${BOOK_SOURCE_LABEL[source as BookSource]} not used: ${why}`);
  for (const f of plan.fills) lines.push(`- Fill ${f.column}: ${fmt(f.value)} (${f.sources.map((s) => BOOK_SOURCE_LABEL[s]).join(" + ")})`);
  for (const f of plan.workFills) lines.push(`- Fill work ${f.column}: ${fmt(f.value)}`);
  for (const d of plan.differs)
    lines.push(`- Differs ${d.column}: ${fmt(d.current)} vs ${Object.entries(d.found).map(([s, v]) => `${BOOK_SOURCE_LABEL[s as BookSource]} ${fmt(v)}`).join(", ")}`);
  for (const h of plan.held) lines.push(`- Held ${h.column}: ${h.reason}`);
  lines.push("");
}
writeFileSync(values.report!, lines.join("\n"));
if (!values.apply) console.log(`Plan written to ${values.report}; nothing was written to the database`);
await sql.end();
