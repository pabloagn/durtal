/**
 * Book metadata enrichment (SLN-414). Reads each edition's ISBN record from
 * ISBNdb and Open Library and fills only empty fields: description, page
 * count, publication year, language and binding, and a work's description
 * when it has none. Values that differ are reported, never changed. ISBNs,
 * publishers, imprints and every image are never written (the rules:
 * `src/lib/books/enrichment.ts`).
 *
 * Modes:
 * - `--assess`: holes per field and works whose original year looks like an
 *   edition year. Read-only; no source is called.
 * - default (plan): calls the sources (paced, every answer cached in --cache,
 *   so a second plan and the apply read the same data), writes the plan to
 *   --report, writes nothing (a read-only transaction).
 * - `--apply --backup FILE`: writes the plan in one transaction, with the
 *   values it wrote in --undo-file. Refuses to run without an existing
 *   backup file. Check the ISBNdb plan's quota first.
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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import postgres from "postgres";
import type { MatchCandidate } from "@/lib/match/plan";
import { cleanRecord, isbndbRecord } from "@/lib/match/source";
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
    "undo-file": { type: "string", default: "book-enrichment-undo.json" },
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
const sql = postgres(url, { max: 1, onnotice: () => {} });

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

if (values.apply && !(values.backup && existsSync(values.backup)))
  throw new Error("--apply needs --backup FILE: a backup taken before this run");

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

async function fromIsbndb(isbn: string): Promise<MatchCandidate | null> {
  const { getIsbndbBook } = await import("@/lib/api/isbndb");
  const book = await paced(() => getIsbndbBook(isbn));
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
      // Not cached: the next run asks again
      console.warn(`${BOOK_SOURCE_LABEL[source]} ${isbn}: ${error instanceof Error ? error.message : "failed"}`);
    }
    writeFileSync(values.cache!, JSON.stringify(cache, null, 2));
  }
  return cached;
}

// ── Plan, and apply when asked ──────────────────────────────────────────────
class Rollback extends Error {}
const runId = randomUUID();
const retrievedAt = new Date();
const plans: { row: EditionRow; plan: EditionPlan }[] = [];
const written: Written[] = [];

try {
  await sql.begin(values.apply ? "read write" : "read only", async (tx) => {
    const rows = await loadEnrichableEditions(tx as unknown as postgres.Sql, {
      limit: values.limit ? Number(values.limit) : undefined,
      ids: values.only?.split(",").filter(Boolean),
    });
    for (const row of rows) {
      const isbn = row.isbn13 ?? row.isbn10!;
      const plan = planEdition(row, await records(isbn));
      plans.push({ row, plan });
      if (values.apply && !plan.skipped && (plan.fills.length || plan.workFills.length))
        written.push(...(await applyEditionPlan(tx as unknown as postgres.Sql, plan, { runId, retrievedAt, isbn })));
    }
    if (!values.apply) throw new Rollback();
  });
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
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
if (values.apply) {
  writeFileSync(values["undo-file"]!, JSON.stringify({ runId, written } satisfies EnrichmentUndo, null, 2));
  console.log(`Applied run ${runId}: ${written.length} values; undo file ${values["undo-file"]}`);
} else console.log(`Plan written to ${values.report}; nothing was written to the database`);
await sql.end();
