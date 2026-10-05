import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { resultRows } from "@/lib/harmonization/store";
import { stripHtmlToText } from "@/lib/utils/sanitize";
import { NOTE_MAX } from "../constants";
import { goodreadsNoteKey } from "../source-keys";
import { firstLines } from "../notes-text";
import type { ImportDecision, ImportMatch, ImportSection } from "./match-rules";
import type { ImportRow } from "./types";

/*
 * Goodreads private notes, imported as notes (SLN-453). A row's note has its
 * own decision (`note_decision`), apart from the row's readings, and the
 * note's id goes in the row's `written.noteIds`. The readings' rules look
 * only at the reading outcomes in `written` (`readingsCommitted`), so a row
 * whose note is in can still be decided and committed for its readings.
 */

/** What a commit recorded on a row; only the fields the note rules read */
interface WrittenShape {
  readings?: { n: number; readingId: string | null }[];
  queueOutcome?: string;
  noteIds?: string[];
}

/** The row's readings or Up Next item were committed; a row with only its note written was not */
export function readingsCommitted(written: WrittenShape | null | undefined): boolean {
  return !!written && ((written.readings?.length ?? 0) > 0 || written.queueOutcome !== undefined);
}

/** The same rule in SQL, for reading_import_rows aliased `alias` */
export function readingsUncommittedSql(alias = "r") {
  const w = sql.raw(`${alias}.written`);
  return sql`(${w} is null or (jsonb_array_length(coalesce(${w}->'readings', '[]'::jsonb)) = 0 and ${w}->'queueOutcome' is null))`;
}

/** The row's note is in Durtal from this import */
export function noteWritten(written: WrittenShape | null | undefined): boolean {
  return (written?.noteIds?.length ?? 0) > 0;
}

/** The note as Durtal keeps it: the private note's text, its tags stripped, its line breaks kept */
export function importNoteBody(privateNotes: string): string {
  return stripHtmlToText(privateNotes);
}

/** The note's source key: goodreads-note:<Book Id>, else by ISBN-13, else by title and author */
export function importNoteKey(data: Pick<ImportRow, "sourceBookId" | "isbn13" | "title" | "authors">): string {
  return goodreadsNoteKey({ bookId: data.sourceBookId, isbn13: data.isbn13, title: data.title, firstAuthor: data.authors[0] ?? "" });
}

/** "Too long to import (12,400 characters; at most 10,000)", or null */
export function noteTooLong(body: string): string | null {
  return body.length > NOTE_MAX
    ? `Too long to import (${body.length.toLocaleString("en-US")} characters; at most ${NOTE_MAX.toLocaleString("en-US")})`
    : null;
}

/**
 * The reading a row's note belongs to: the row's latest read that is in
 * Durtal, written by a commit or matched as already there; else none.
 */
export function noteReadingId(written: WrittenShape | null | undefined, match: Pick<ImportMatch, "verdicts"> | null): string | null {
  const ids = new Map<number, string>();
  for (const v of match?.verdicts ?? []) if (v.readingId) ids.set(v.n, v.readingId);
  for (const r of written?.readings ?? []) if (r.readingId) ids.set(r.n, r.readingId);
  const last = [...ids.keys()].sort((a, b) => b - a)[0];
  return last === undefined ? null : ids.get(last)!;
}

/** Where a row's note stands, for the preview and the commit */
export type ImportNoteState = "imported" | "present" | "too_long" | "no_book" | ImportDecision;

export function importNoteState(input: {
  written: WrittenShape | null;
  keyExists: boolean;
  tooLong: boolean;
  workId: string | null;
  decision: ImportDecision;
}): ImportNoteState {
  if (noteWritten(input.written)) return "imported";
  if (input.keyExists) return "present";
  if (input.tooLong) return "too_long";
  if (!input.workId) return "no_book";
  return input.decision;
}

interface NoteRowRecord {
  rowNo: number;
  workId: string | null;
  noteDecision: ImportDecision;
  written: WrittenShape | null;
  match: ImportMatch | null;
  data: Pick<ImportRow, "sourceBookId" | "isbn13" | "title" | "authors">;
  /** The private note's raw length */
  length: number;
}

/** Every row of an import that has a private note, without the note's text */
async function noteRows(importId: string): Promise<NoteRowRecord[]> {
  return resultRows<NoteRowRecord>(
    await db.execute(sql`
      select r.row_no as "rowNo", r.work_id::text as "workId", r.note_decision as "noteDecision", r.written, r.match,
        jsonb_build_object('sourceBookId', r.data->'sourceBookId', 'isbn13', r.data->'isbn13', 'title', r.data->'title', 'authors', r.data->'authors') as data,
        length(r.data->>'privateNotes')::int as length
      from reading_import_rows r
      where r.import_id = ${importId}::uuid and r.data->>'privateNotes' is not null
      order by r.row_no`),
  );
}

/** The private notes' texts of these rows */
async function noteTexts(importId: string, rowNos: number[]): Promise<Map<number, string>> {
  if (!rowNos.length) return new Map();
  return new Map(
    resultRows<{ rowNo: number; text: string }>(
      await db.execute(sql`
        select r.row_no as "rowNo", r.data->>'privateNotes' as text from reading_import_rows r
        where r.import_id = ${importId}::uuid and r.row_no in (select value::int from jsonb_array_elements_text(${JSON.stringify(rowNos)}::jsonb))`),
    ).map((r) => [r.rowNo, r.text]),
  );
}

/** The note keys among these already in Durtal */
async function existingKeys(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  return new Set(
    resultRows<{ key: string }>(
      await db.execute(sql`select source_key as key from reading_notes where source_key in (select value from jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`),
    ).map((r) => r.key),
  );
}

/** Each row with its key, whether it is too long, and its state */
async function withStates(importId: string, rows: NoteRowRecord[]) {
  // The stripped text is never longer than the raw one: only long notes are read here
  const long = await noteTexts(
    importId,
    rows.filter((r) => r.length > NOTE_MAX).map((r) => r.rowNo),
  );
  const keyed = rows.map((r) => {
    const body = long.get(r.rowNo);
    const tooLong = body !== undefined ? noteTooLong(importNoteBody(body)) : null;
    return { ...r, key: importNoteKey(r.data), tooLong };
  });
  const present = await existingKeys(keyed.filter((r) => !noteWritten(r.written)).map((r) => r.key));
  return keyed.map((r) => ({
    ...r,
    state: importNoteState({ written: r.written, keyExists: present.has(r.key), tooLong: !!r.tooLong, workId: r.workId, decision: r.noteDecision }),
  }));
}

export interface ImportNoteView {
  rowNo: number;
  title: string;
  author: string | null;
  /** The note's first three lines */
  preview: string;
  book: { href: string; title: string; author: string | null } | null;
  state: ImportNoteState;
  /** "Too long to import (...)" */
  reason: string | null;
}

/** The preview's "Private notes": the count, the notes a commit would write, and the first `limit` rows */
export async function getImportNotes(importId: string, limit: number) {
  const rows = await withStates(importId, await noteRows(importId));
  const shown = rows.slice(0, limit);
  const [texts, books] = await Promise.all([
    noteTexts(importId, shown.map((r) => r.rowNo)),
    db.execute(sql`
      select w.id::text as id, w.title, w.slug,
        (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id order by wa.sort_order, a.name limit 1) as author
      from works w where w.id in (select value::uuid from jsonb_array_elements_text(${JSON.stringify(shown.flatMap((r) => (r.workId ? [r.workId] : [])))}::jsonb))`),
  ]);
  const bookOf = new Map(resultRows<{ id: string; title: string; slug: string | null; author: string | null }>(books).map((b) => [b.id, b]));
  return {
    count: rows.length,
    toImport: rows.filter((r) => r.state === "import").length,
    imported: rows.filter((r) => r.state === "imported").length,
    rows: shown.map((r): ImportNoteView => {
      const book = r.workId ? bookOf.get(r.workId) : undefined;
      return {
        rowNo: r.rowNo,
        title: r.data.title || "No title",
        author: r.data.authors[0] ?? null,
        preview: firstLines(importNoteBody(texts.get(r.rowNo) ?? ""), 3),
        book: book ? { href: `/library/${book.slug ?? book.id}`, title: book.title, author: book.author } : null,
        state: r.state,
        reason: r.tooLong,
      };
    }),
  };
}

const NOTE_WRITTEN_MESSAGE = "This note was imported; undo the import to change it";

/** Import or skip one row's private note: one UPDATE; the reasons are read only when it changes nothing */
export async function decideNote(input: { importId: string; rowNo: number; decision: ImportDecision }) {
  const updated = resultRows<{ rowNo: number }>(
    await db.execute(sql`
      update reading_import_rows r set note_decision = ${input.decision}
      where r.import_id = ${input.importId}::uuid and r.row_no = ${input.rowNo}
        and r.data->>'privateNotes' is not null
        and coalesce(jsonb_array_length(r.written->'noteIds'), 0) = 0
        and (${input.decision}::text <> 'import' or r.work_id is not null)
      returning r.row_no as "rowNo"`),
  );
  if (updated.length) return;
  const [row] = resultRows<{ hasNote: boolean; written: WrittenShape | null; workId: string | null }>(
    await db.execute(sql`select r.data->>'privateNotes' is not null as "hasNote", r.written, r.work_id::text as "workId"
      from reading_import_rows r where r.import_id = ${input.importId}::uuid and r.row_no = ${input.rowNo}`),
  );
  if (!row) throw new Error("This row is not in the import");
  if (!row.hasNote) throw new Error("This row has no private note");
  if (noteWritten(row.written)) throw new Error(NOTE_WRITTEN_MESSAGE);
  throw new Error("Choose this row's book first");
}

/** "Import all private notes": every note with a book and not imported yet, in one UPDATE */
export async function decideAllNotes(importId: string) {
  const updated = resultRows<{ rowNo: number }>(
    await db.execute(sql`
      update reading_import_rows r set note_decision = 'import'
      where r.import_id = ${importId}::uuid and r.data->>'privateNotes' is not null and r.work_id is not null
        and r.note_decision <> 'import' and coalesce(jsonb_array_length(r.written->'noteIds'), 0) = 0
      returning r.row_no as "rowNo"`),
  );
  return { changed: updated.length };
}

const COMMIT_NOTES = 100;

/**
 * Writes the private notes decided "import" of rows with a book and no note
 * written yet: kind note, source import, the row's latest reading, and the
 * key from `importNoteKey`. A key already in Durtal writes nothing; a note
 * over 10,000 characters is left out with its reason. The note's id goes in
 * the row's `written.noteIds` in the same write.
 */
export async function commitNotes(importId: string) {
  const rows = (await withStates(importId, await noteRows(importId))).filter((r) => r.noteDecision === "import" && r.workId && !noteWritten(r.written));
  const out = { written: 0, present: 0, errors: [] as { rowNo: number; reason: string }[] };
  for (const r of rows) {
    if (r.state === "present") out.present++;
    else if (r.state === "too_long") out.errors.push({ rowNo: r.rowNo, reason: `Private note: ${r.tooLong}` });
  }
  const todo = rows.filter((r) => r.state === "import");
  for (let at = 0; at < todo.length; at += COMMIT_NOTES) {
    const chunk = todo.slice(at, at + COMMIT_NOTES);
    const texts = await noteTexts(importId, chunk.map((r) => r.rowNo));
    const send = chunk.map((r) => ({
      id: randomUUID(),
      row_no: r.rowNo,
      work_id: r.workId,
      reading_id: noteReadingId(r.written, r.match),
      body: importNoteBody(texts.get(r.rowNo) ?? ""),
      key: r.key,
    }));
    const notes = send.filter((s) => s.body);
    const ids = notes.map((s) => ({ row_no: s.row_no, ids: [s.id] }));
    await withReadableErrors(() =>
      atomic((d) => [
        d.execute(sql`
          insert into reading_notes (id, work_id, reading_id, kind, body, source, import_id, source_key)
          select x.id, x.work_id, (select r.id from readings r where r.id = x.reading_id and r.work_id = x.work_id),
            'note', x.body, 'import', ${importId}::uuid, x.key
          from jsonb_to_recordset(${JSON.stringify(notes)}::jsonb) as x(id uuid, row_no int, work_id uuid, reading_id uuid, body text, key text)`),
        d.execute(sql`
          update reading_import_rows r
          set written = coalesce(r.written, '{"readings": [], "bookRating": null, "identifiers": []}'::jsonb) || jsonb_build_object('noteIds', v.ids)
          from jsonb_to_recordset(${JSON.stringify(ids)}::jsonb) as v(row_no int, ids jsonb)
          where r.import_id = ${importId}::uuid and r.row_no = v.row_no`),
      ]),
    );
    out.written += notes.length;
  }
  return out;
}

/**
 * Undo's notes: deletes the import's notes not edited since (their
 * updated_at is still their created_at), those in `written.noteIds` and any
 * the rows miss, then clears `noteIds`. Edited notes are kept.
 */
export async function undoNotes(importId: string) {
  const removed = resultRows<{ id: string }>(
    await db.execute(sql`
      delete from reading_notes n
      where (n.import_id = ${importId}::uuid
          or n.id in (select value::uuid from reading_import_rows r, jsonb_array_elements_text(coalesce(r.written->'noteIds', '[]'::jsonb))
            where r.import_id = ${importId}::uuid))
        and n.source = 'import' and n.updated_at = n.created_at
      returning n.id::text as id`),
  );
  const [kept] = resultRows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from reading_notes where import_id = ${importId}::uuid`),
  );
  await db.execute(sql`
    update reading_import_rows r
    set written = case when jsonb_array_length(coalesce(r.written->'readings', '[]'::jsonb)) = 0 and r.written->'queueOutcome' is null
      then null else r.written - 'noteIds' end
    where r.import_id = ${importId}::uuid and r.written ? 'noteIds'`);
  return { removed: removed.length, kept: kept?.n ?? 0 };
}

/** The sections a row's note decision defaults to "import" in: the exact matches */
export function defaultNoteDecision(section: ImportSection, privateNotes: string | null): ImportDecision {
  return privateNotes && section === "exact" ? "import" : "pending";
}
