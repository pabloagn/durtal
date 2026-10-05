import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { imports, readingImportRows } from "@/lib/db/schema";
import { resultRows } from "@/lib/harmonization/store";
import { requireBookWork } from "@/lib/catalogue/book-boundary";
import { CACHE_TAGS, invalidate } from "@/lib/cache";
import { writeReadings, type WriteOutcome } from "../service";
import type { WriteReadingRow } from "@/lib/validations/reading";
import { matchRows, withVerdicts, type MatchedRow } from "./match";
import { defaultDecision, onlyUndated, type ImportDecision, type ImportMatch, type ImportSection } from "./match-rules";
import { parseImportFile } from "./parse";
import type { ImportReading, ImportRow, ImportSource } from "./types";

/*
 * An import's working state in Postgres (SLN-450): the upload writes the
 * import and one row per data row; decisions are one UPDATE each; the commit
 * writes readings through `writeReadings` in chunks that never split a book,
 * recording each row's outcome in `written`; undo reads `written` back. A
 * commit or an undo stopped half way can be run again.
 */

export type ImportStatus = "pending" | "completed" | "undone";

export interface Written {
  readings: { n: number; outcome: WriteOutcome["outcome"]; readingId: string | null; reason: string | null }[];
  /** The book rating the commit changed, for undo */
  bookRating: { workId: string; before: number | null; after: number | null } | null;
  /** Goodreads identifiers the commit recorded */
  identifiers: string[];
}

export interface StoredRow {
  rowNo: number;
  data: ImportRow;
  match: ImportMatch;
  decision: ImportDecision;
  useFileRating: boolean;
  workId: string | null;
  written: Written | null;
}

export interface ImportErrorLog {
  /** What the file's columns cannot carry */
  missing: string[];
  /** The rows the last commit could not write: row number and reason, never raw cells */
  errors: { rowNo: number; reason: string }[];
}

const INSERT_ROWS = 500;
const COMMIT_READINGS = 100;
const json = (value: unknown) => JSON.stringify(value);

/** A file name to show: the base name, no control characters, at most 255 characters */
export function displayFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) || "import.csv";
}

/** A file name for the S3 key: letters, digits, ".", "-" and "_" only */
export function safeFileName(name: string) {
  const safe = displayFileName(name).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 200);
  return safe || "import.csv";
}

function toStored(r: typeof readingImportRows.$inferSelect): StoredRow {
  return {
    rowNo: r.rowNo,
    data: r.data as ImportRow,
    match: r.match as ImportMatch,
    decision: r.decision,
    useFileRating: r.useFileRating,
    workId: r.workId,
    written: (r.written as Written | null) ?? null,
  };
}

async function loadRows(importId: string, where = sql`true`): Promise<StoredRow[]> {
  const rows = await db
    .select()
    .from(readingImportRows)
    .where(and(eq(readingImportRows.importId, importId), where))
    .orderBy(asc(readingImportRows.rowNo));
  return rows.map(toStored);
}

const asMatched = (r: StoredRow): MatchedRow => ({ rowNo: r.rowNo, data: r.data, workId: r.workId, match: r.match });

/** Parses, matches and stores a file: the import and its rows in one write. Reads only until then */
export async function createReadingImport(input: { text: string; fileName: string }): Promise<{ importId: string; source: ImportSource; rows: number }> {
  const importId = randomUUID();
  const parsed = parseImportFile(input.text);
  const found = await matchRows(parsed.rows);
  const matched: MatchedRow[] = parsed.rows.map((data, i) => {
    const { workId, ...rest } = found[i];
    return { rowNo: parsed.rowNos[i], data, workId, match: { ...rest, chosen: false } };
  });
  const full = await withVerdicts(parsed.source, matched);
  const values = matched.map((r, i) => ({
    importId,
    rowNo: r.rowNo,
    data: r.data,
    match: full[i],
    decision: defaultDecision(full[i].section),
    workId: r.workId,
  }));
  const errorLog: ImportErrorLog = { missing: parsed.missing, errors: [] };
  await withReadableErrors(() =>
    atomic((d) => {
      const queries: unknown[] = [
        d.insert(imports).values({
          id: importId,
          source: parsed.source,
          status: "pending",
          fileName: displayFileName(input.fileName),
          totalRecords: values.length,
          errorLog,
          startedAt: new Date(),
        }),
      ];
      for (let at = 0; at < values.length; at += INSERT_ROWS) queries.push(d.insert(readingImportRows).values(values.slice(at, at + INSERT_ROWS)));
      return queries;
    }),
  );
  return { importId, source: parsed.source, rows: values.length };
}

/** Records where the raw file was kept */
export async function setBronzeKey(importId: string, key: string) {
  await db.update(imports).set({ s3BronzeKey: key }).where(eq(imports.id, importId));
}

/** The import, locked for the length of one write, with its status checked */
async function lockedImport(importId: string, allowed: ImportStatus[]) {
  const [locked] = (await atomic((d) => [d.execute(sql`select id, status, source from imports where id = ${importId}::uuid for update`)])) as unknown[];
  const [row] = resultRows<{ id: string; status: ImportStatus; source: ImportSource }>(locked);
  if (!row) throw new Error("This import does not exist");
  if (!allowed.includes(row.status)) throw new Error(`This import is ${row.status}`);
  if (!["goodreads", "storygraph", "durtal"].includes(row.source)) throw new Error("This is not a reading import");
  return row;
}

/** What changes when a row's section changes: its section's default; otherwise the decision stays */
function nextDecision(before: ImportSection | undefined, after: ImportSection, decision: ImportDecision): ImportDecision {
  return before === after ? decision : defaultDecision(after);
}

/**
 * Recomputes the verdicts and sections of these books' rows, and of the rows
 * given, from the readings now in Durtal. Written rows keep the match they
 * were written with.
 */
async function refreshRows(importId: string, source: ImportSource, workIds: string[], extra: StoredRow[] = []) {
  const ids = [...new Set(workIds.filter(Boolean))];
  const ofBooks = ids.length ? await loadRows(importId, inArray(readingImportRows.workId, ids)) : [];
  const rows = [...new Map([...ofBooks, ...extra].map((r) => [r.rowNo, r])).values()].sort((a, b) => a.rowNo - b.rowNo);
  if (!rows.length) return;
  const full = await withVerdicts(source, rows.map(asMatched));
  const updates = rows
    .map((r, i) => ({ r, match: full[i] }))
    .filter(({ r }) => !r.written)
    .map(({ r, match }) => ({
      row_no: r.rowNo,
      work_id: r.workId,
      match,
      decision: nextDecision(r.match?.section, match.section, r.decision),
    }));
  if (!updates.length) return;
  await db.execute(sql`
    update reading_import_rows r
    set match = v.match, work_id = v.work_id, decision = v.decision
    from jsonb_to_recordset(${json(updates)}::jsonb) as v(row_no int, work_id uuid, match jsonb, decision text)
    where r.import_id = ${importId}::uuid and r.row_no = v.row_no and r.written is null`);
}

const writtenMessage = "This row was imported; undo the import to change it";

async function oneRow(importId: string, rowNo: number) {
  const [row] = await loadRows(importId, eq(readingImportRows.rowNo, rowNo));
  if (!row) throw new Error("This row is not in the import");
  return row;
}

/** Import, skip, or the file's rating: one UPDATE of one row */
export async function decideRow(input: { importId: string; rowNo: number; decision?: ImportDecision; useFileRating?: boolean }) {
  const row = await oneRow(input.importId, input.rowNo);
  if (row.written) throw new Error(writtenMessage);
  if (input.decision === "import") {
    if (row.match.section === "cannot") throw new Error("This row cannot be imported");
    if (row.match.section === "not_imported") throw new Error("Want-to-read books are not imported yet");
    if (!row.workId) throw new Error("Choose a book first");
    if (row.match.section === "present" && !onlyUndated(row.match.verdicts)) throw new Error("These reads are already in Durtal");
  }
  const updated = await db
    .update(readingImportRows)
    .set({
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.useFileRating !== undefined ? { useFileRating: input.useFileRating } : {}),
    })
    .where(and(eq(readingImportRows.importId, input.importId), eq(readingImportRows.rowNo, input.rowNo), isNull(readingImportRows.written)))
    .returning({ rowNo: readingImportRows.rowNo });
  if (!updated.length) throw new Error(writtenMessage);
}

/** Choose another book: the row's book, its readings checked again, and the decision import */
export async function chooseBook(input: { importId: string; rowNo: number; workId: string }) {
  const imp = await lockedImport(input.importId, ["pending", "completed", "undone"]);
  await requireBookWork(input.workId);
  const row = await oneRow(input.importId, input.rowNo);
  if (row.written) throw new Error(writtenMessage);
  if (row.data.error) throw new Error("This row cannot be imported");
  const previous = row.workId;
  const moved: StoredRow = {
    ...row,
    workId: input.workId,
    // A book chosen by hand has no edition from the file's identifiers
    match: { ...row.match, chosen: true, editionId: row.workId === input.workId ? row.match.editionId : null, instanceId: null },
  };
  await db
    .update(readingImportRows)
    .set({ workId: input.workId, match: moved.match })
    .where(and(eq(readingImportRows.importId, input.importId), eq(readingImportRows.rowNo, input.rowNo), isNull(readingImportRows.written)));
  await refreshRows(input.importId, imp.source, [input.workId, previous ?? ""], [moved]);
  const [after] = await loadRows(input.importId, eq(readingImportRows.rowNo, input.rowNo));
  const decision = after.match.section === "present" || after.match.section === "cannot" ? "skip" : "import";
  await db
    .update(readingImportRows)
    .set({ decision })
    .where(and(eq(readingImportRows.importId, input.importId), eq(readingImportRows.rowNo, input.rowNo), isNull(readingImportRows.written)));
}

/** "Accept all likely matches" and "Skip all not in Durtal": one UPDATE over the section's undecided rows */
export async function decideSection(input: { importId: string; section: "likely" | "none"; decision: ImportDecision }) {
  if (input.section === "none" && input.decision === "import") throw new Error("Rows not in Durtal have no book to import to");
  const updated = await db
    .update(readingImportRows)
    .set({ decision: input.decision })
    .where(
      and(
        eq(readingImportRows.importId, input.importId),
        sql`${readingImportRows.match}->>'section' = ${input.section}`,
        eq(readingImportRows.decision, "pending"),
        isNull(readingImportRows.written),
        input.section === "likely" ? sql`${readingImportRows.workId} is not null` : sql`true`,
      ),
    )
    .returning({ rowNo: readingImportRows.rowNo });
  return { changed: updated.length };
}

/** "Match again": matching and the duplicate check, for the rows still without a book */
export async function rematch(importId: string) {
  const imp = await lockedImport(importId, ["pending", "completed", "undone"]);
  const rows = (await loadRows(importId, sql`${readingImportRows.workId} is null and ${readingImportRows.written} is null`)).filter(
    (r) => !r.data.error,
  );
  if (!rows.length) return { matched: 0 };
  const found = await matchRows(rows.map((r) => r.data));
  const moved = rows.map((r, i): StoredRow => {
    const { workId, ...rest } = found[i];
    return { ...r, workId, match: { ...r.match, ...rest, chosen: false } };
  });
  await refreshRows(importId, imp.source, moved.map((r) => r.workId ?? ""), moved);
  return { matched: moved.filter((r) => r.workId).length };
}

/* ── Commit ─────────────────────────────────────────────────────────────── */

export interface CommitResult {
  written: number;
  present: number;
  refused: number;
  rows: number;
}

/** The total a reading is written with: the file's own, else the edition's, else Goodreads' page count; never below the position */
function pagesFor(reading: ImportReading, row: ImportRow, editionPages: number | null) {
  const total = reading.totalPages ?? editionPages ?? row.pages ?? null;
  const page = reading.position?.page ?? null;
  return total !== null && page !== null && page > total ? null : total;
}

/**
 * Writes the readings of the rows decided "import" and not yet written. The
 * readings are checked again against what Durtal holds now; a book's rows go
 * to `writeReadings` together, so the count rule sees them all.
 */
export async function commitImport(importId: string): Promise<CommitResult> {
  const imp = await lockedImport(importId, ["pending", "completed", "undone"]);
  const all = await loadRows(importId);
  const counted = all.filter((r) => r.workId && !r.data.error && r.data.kind === "readings");
  const fresh = await withVerdicts(imp.source, counted.map(asMatched));
  const now = new Map(counted.map((r, i) => [r.rowNo, fresh[i]]));
  const todo = counted.filter((r) => r.decision === "import" && !r.written);
  const editionIds = [...new Set(todo.map((r) => r.match.editionId).filter((id): id is string => !!id))];
  const editionPages = new Map(
    editionIds.length
      ? resultRows<{ id: string; pages: number | null }>(
          await db.execute(sql`select id::text as id, page_count as pages from editions where id in (select value::uuid from jsonb_array_elements_text(${json(editionIds)}::jsonb))`),
        ).map((e) => [e.id, e.pages])
      : [],
  );
  const errors: ImportErrorLog["errors"] = [];

  // Each row's readings: written by writeReadings, or recorded as they stand
  const plans = todo.flatMap((row) => {
    const match = now.get(row.rowNo)!;
    if (match.section === "cannot") {
      errors.push({ rowNo: row.rowNo, reason: (match.note ?? "Cannot import").slice(0, 200) });
      return [];
    }
    const anyway = match.section === "present" && onlyUndated(match.verdicts);
    const items = row.data.readings.map((reading, k) => {
      const verdict = match.verdicts[k];
      const hold = verdict.verdict === "refused" || verdict.reason === "Already open in Durtal";
      const send: WriteReadingRow | null = hold
        ? null
        : {
            workId: row.workId!,
            readingId: reading.readingId,
            editionId: row.match.editionId,
            instanceId: row.match.instanceId,
            format: reading.format,
            unit: reading.unit,
            status: reading.status,
            startedOn: reading.startedOn,
            startedPrecision: reading.startedPrecision,
            finishedOn: reading.finishedOn,
            finishedPrecision: reading.finishedPrecision,
            totalPages: pagesFor(reading, row.data, row.match.editionId ? (editionPages.get(row.match.editionId) ?? null) : null),
            totalMinutes: reading.totalMinutes,
            position: reading.position,
            rating: reading.rating,
            reviewHtml: reading.reviewHtml,
            abandonReason: reading.abandonReason,
            abandonNote: reading.abandonNote,
            sourceKey: reading.sourceKey,
            bookRating: row.useFileRating ? "replace" : "if_none",
            allowPossibleDuplicate: anyway && verdict.reason === "Undated read",
          };
      return { reading, verdict, send };
    });
    return [{ row, items }];
  });

  // Chunks of at most 100 readings that never split a book (a book with more is a chunk of its own)
  const byBook = new Map<string, typeof plans>();
  for (const p of plans) byBook.set(p.row.workId!, [...(byBook.get(p.row.workId!) ?? []), p]);
  const chunks: (typeof plans)[] = [];
  let current: typeof plans = [];
  let size = 0;
  for (const book of byBook.values()) {
    const n = book.reduce((s, p) => s + p.items.filter((x) => x.send).length, 0);
    if (current.length && size + n > COMMIT_READINGS) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(...book);
    size += n;
  }
  if (current.length) chunks.push(current);

  const result: CommitResult = { written: 0, present: 0, refused: 0, rows: 0 };
  for (const chunk of chunks) {
    const sends = chunk.flatMap((p) => p.items.filter((x) => x.send));
    const outcomes = sends.length ? await writeReadings(sends.map((x) => x.send!), { source: "import", importId }) : [];
    const outcomeOf = new Map(sends.map((x, k) => [x, outcomes[k]]));
    // The Goodreads id of an edition matched by ISBN, so the next import matches it exactly
    const ids = chunk
      .filter((p) => p.row.match.reason === "Same ISBN" && p.row.match.editionId && p.row.data.sourceBookId)
      .map((p) => ({ row_no: p.row.rowNo, edition_id: p.row.match.editionId, gid: p.row.data.sourceBookId }));
    const added = ids.length
      ? resultRows<{ id: string; edition_id: string; external_id: string }>(
          await db.execute(sql`
            insert into catalogue_identifiers (entity_kind, edition_id, provider, external_id)
            select distinct 'edition', x.edition_id, 'goodreads', x.gid
            from jsonb_to_recordset(${json(ids)}::jsonb) as x(row_no int, edition_id uuid, gid text)
            join editions e on e.id = x.edition_id and e.goodreads_id is null
            on conflict on constraint catalogue_identifier_namespace_unique do nothing
            returning id::text, edition_id::text, external_id`),
        )
      : [];
    const written = chunk.map((p) => {
      const readings: Written["readings"] = p.items.map((item) => {
        const n = item.reading.n;
        const o = item.send ? outcomeOf.get(item) : undefined;
        if (o) return { n, outcome: o.outcome, readingId: o.readingId ?? o.match?.readingId ?? null, reason: o.reason ?? o.match?.reason ?? null };
        if (item.verdict.verdict === "refused") return { n, outcome: "refused", readingId: null, reason: item.verdict.reason };
        return { n, outcome: "already_present", readingId: item.verdict.readingId, reason: item.verdict.reason };
      });
      const rating = p.items.map((x) => (x.send ? outcomeOf.get(x)?.bookRating : undefined)).find((b) => b && b.after !== b.before);
      const mine = added.filter((a) => a.edition_id === p.row.match.editionId && a.external_id === p.row.data.sourceBookId).map((a) => a.id);
      for (const r of readings) {
        if (r.outcome === "written") result.written++;
        else if (r.outcome === "already_present") result.present++;
        else result.refused++;
        if (r.outcome === "refused" || r.outcome === "possible_duplicate")
          errors.push({ rowNo: p.row.rowNo, reason: `Read ${r.n}: ${(r.reason ?? "Not written").slice(0, 200)}` });
      }
      result.rows++;
      return {
        row_no: p.row.rowNo,
        written: { readings, bookRating: rating ? { workId: p.row.workId!, ...rating } : null, identifiers: mine } satisfies Written,
      };
    });
    await db.execute(sql`
      update reading_import_rows r set written = v.written
      from jsonb_to_recordset(${json(written)}::jsonb) as v(row_no int, written jsonb)
      where r.import_id = ${importId}::uuid and r.row_no = v.row_no`);
  }

  // The import's counts, over every commit so far
  const errorLog: ImportErrorLog = { missing: [], errors: errors.slice(0, 1000) };
  await atomic((d) => [
    d.execute(sql`select id from imports where id = ${importId}::uuid for update`),
    d.execute(sql`
      update imports i set
        processed_records = (select count(*) from reading_import_rows r where r.import_id = i.id and r.written is not null),
        skipped_records = (select count(*) from reading_import_rows r where r.import_id = i.id and r.written is null and r.decision <> 'import'),
        error_records = ${errors.length},
        error_log = jsonb_build_object('missing', coalesce(i.error_log->'missing', '[]'::jsonb), 'errors', ${json(errorLog.errors)}::jsonb),
        status = 'completed',
        completed_at = now()
      where i.id = ${importId}::uuid`),
  ]);
  invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
  return result;
}

/* ── Undo ───────────────────────────────────────────────────────────────── */

export interface UndoResult {
  removed: number;
  /** Readings edited after the import, kept */
  kept: number;
}

/**
 * Removes what the import wrote: its readings not edited since (no change,
 * no session), the book ratings it set while they still hold, and the
 * identifiers it added. Edited readings stay. Can be run again; the import
 * keeps its decisions and can be committed again.
 */
export async function undoImport(importId: string): Promise<UndoResult> {
  await lockedImport(importId, ["pending", "completed"]);
  const mine = resultRows<{ id: string; removable: boolean }>(
    await db.execute(sql`
      select r.id::text as id,
        (r.updated_at = r.created_at and not exists (select 1 from reading_sessions s where s.reading_id = r.id)) as removable
      from readings r where r.import_id = ${importId}::uuid order by r.created_at, r.id`),
  );
  const removable = mine.filter((r) => r.removable).map((r) => r.id);
  for (let at = 0; at < removable.length; at += COMMIT_READINGS) {
    const ids = removable.slice(at, at + COMMIT_READINGS);
    await atomic((d) => [
      d.execute(sql`
        delete from readings r
        where r.id in (select value::uuid from jsonb_array_elements_text(${json(ids)}::jsonb))
          and r.updated_at = r.created_at
          and not exists (select 1 from reading_sessions s where s.reading_id = r.id)`),
    ]);
  }
  const rows = await loadRows(importId, sql`${readingImportRows.written} is not null`);
  // Book ratings, the last change first, only while the book still has the import's rating
  const ratings = [...rows].reverse().flatMap((r) => (r.written?.bookRating ? [r.written.bookRating] : []));
  const identifiers = rows.flatMap((r) => r.written?.identifiers ?? []);
  const left = new Set(
    resultRows<{ id: string }>(await db.execute(sql`select id::text as id from readings where import_id = ${importId}::uuid`)).map((r) => r.id),
  );
  const rewritten = rows.map((r) => {
    const kept = (r.written?.readings ?? []).filter((x) => x.outcome === "written" && x.readingId && left.has(x.readingId));
    return { row_no: r.rowNo, written: kept.length ? ({ readings: kept, bookRating: null, identifiers: [] } satisfies Written) : null };
  });
  await atomic((d) => [
    ...ratings.map((b) =>
      d.execute(sql`update works set rating = ${b.before}, updated_at = now() where id = ${b.workId}::uuid and rating is not distinct from ${b.after}::numeric`),
    ),
    ...(identifiers.length
      ? [d.execute(sql`delete from catalogue_identifiers where id in (select value::uuid from jsonb_array_elements_text(${json(identifiers)}::jsonb))`)]
      : []),
    ...(rewritten.length
      ? [
          d.execute(sql`
            update reading_import_rows r set written = v.written
            from jsonb_to_recordset(${json(rewritten)}::jsonb) as v(row_no int, written jsonb)
            where r.import_id = ${importId}::uuid and r.row_no = v.row_no`),
        ]
      : []),
    d.execute(sql`update imports set status = 'undone', processed_records = 0 where id = ${importId}::uuid`),
  ]);
  invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
  return { removed: mine.length - left.size, kept: left.size };
}
