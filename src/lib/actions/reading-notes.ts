"use server";

import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { activityEvents, editions, imports, readingNotes, readings } from "@/lib/db/schema";
import { resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { requireBookWork } from "@/lib/catalogue/book-boundary";
import { textSearchCondition, textSearchRank } from "@/lib/actions/utils/text-search";
import { sanitizeCommentHtml, stripHtmlToText } from "@/lib/utils/sanitize";
import { appTimeZone } from "@/lib/utils/date";
import { readingToday } from "@/lib/reading/day";
import { percentOf } from "@/lib/reading/positions";
import { readingOrdinalSql } from "@/lib/reading/summary";
import { notesCondition } from "@/lib/reading/notes-conditions";
import { choosePassage, passageCandidates } from "@/lib/reading/passage";
import type { NoteKind, NoteSource } from "@/lib/reading/constants";
import {
  createReadingNoteSchema,
  noteIdSchema,
  noteSnapshotSchema,
  passageSchema,
  searchNotesSchema,
  updateReadingNoteSchema,
  type NoteSnapshot,
} from "@/lib/validations/reading-notes";

/*
 * The commonplace book (SLN-453): quotes and notes against a book, its page,
 * chapter, edition and reading. Books only. Pages always write source
 * "manual"; the import writes its own (src/lib/reading/import/store.ts).
 * Every write invalidates the works and reading tags.
 */

/** A quote or note as the pages show it */
export interface NoteItem {
  id: string;
  workId: string;
  kind: NoteKind;
  body: string;
  commentHtml: string | null;
  commentJson: unknown;
  page: number | null;
  chapter: string | null;
  percent: number | null;
  isFavourite: boolean;
  readingId: string | null;
  /** The reading's number among the book's readings: 2 for "2nd read" */
  readingOrdinal: number | null;
  editionId: string | null;
  source: NoteSource;
  createdAt: string;
  updatedAt: string;
}

/** What the note dialog edits, and what a list sends the browser for each note: no dates, no Tiptap JSON (the editor opens from the HTML) */
export type NoteEdit = Pick<
  NoteItem,
  "id" | "workId" | "kind" | "body" | "commentHtml" | "page" | "chapter" | "percent" | "isFavourite" | "readingId" | "readingOrdinal"
> & { commentJson?: unknown };

/** A note with its book, for the commonplace book and the passage of the day */
export interface NoteWithBook extends NoteItem {
  book: { id: string; title: string; slug: string | null; author: string | null };
}

function changed() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
}

/** The columns of a NoteItem, from reading_notes aliased n */
const NOTE_COLUMNS = sql`n.id, n.work_id as "workId", n.kind, n.body, n.comment_html as "commentHtml", n.comment_json as "commentJson",
  n.page, n.chapter, n.percent::float8 as percent, n.is_favourite as "isFavourite", n.reading_id as "readingId", n.edition_id as "editionId",
  n.source, to_json(n.created_at)#>>'{}' as "createdAt", to_json(n.updated_at)#>>'{}' as "updatedAt",
  (select o.ordinal from (select r.id, ${readingOrdinalSql("r")} as ordinal from readings r where r.work_id = n.work_id) o
    where o.id = n.reading_id)::int as "readingOrdinal"`;

/** The book of a note aliased n, its first author first */
const BOOK_COLUMN = sql`(select jsonb_build_object('id', w.id, 'title', w.title, 'slug', w.slug,
    'author', (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id order by wa.sort_order, a.name limit 1))
  from works w where w.id = n.work_id) as book`;

async function loadNote(id: string): Promise<NoteItem | null> {
  const [row] = resultRows<NoteItem>(await db.execute(sql`select ${NOTE_COLUMNS} from reading_notes n where n.id = ${id}::uuid`));
  return row ?? null;
}

async function noteOrThrow(id: string) {
  const [row] = await db.select().from(readingNotes).where(eq(readingNotes.id, id));
  if (!row) throw new Error("This note no longer exists");
  return row;
}

/** The reading and the edition a note may point at, checked against its book */
async function references(workId: string, readingId: string | null | undefined, editionId: string | null | undefined) {
  let reading: { id: string; editionId: string | null; totalPages: number | null } | null = null;
  if (readingId) {
    const [row] = await db
      .select({ id: readings.id, workId: readings.workId, editionId: readings.editionId, totalPages: readings.totalPages })
      .from(readings)
      .where(eq(readings.id, readingId));
    if (!row) throw new Error("This reading no longer exists");
    if (row.workId !== workId) throw new Error("This reading belongs to another book");
    reading = row;
  }
  // A note on a reading is on its edition unless it names another
  const edition = editionId === undefined ? (reading?.editionId ?? null) : editionId;
  let pageCount: number | null = null;
  if (edition) {
    const [row] = await db.select({ workId: editions.workId, pageCount: editions.pageCount }).from(editions).where(eq(editions.id, edition));
    if (!row) throw new Error("This edition no longer exists");
    if (row.workId !== workId) throw new Error("This edition belongs to another book");
    pageCount = row.pageCount;
  }
  return { reading, editionId: edition, totalPages: reading?.totalPages ?? pageCount };
}

/** His thought, sanitized; an empty editor is no thought */
function thought(kind: NoteKind, html: string | null | undefined, json: unknown) {
  if (html == null && json == null) return { commentHtml: null, commentJson: null };
  if (kind !== "quote") throw new Error("Only a quote carries a thought");
  const clean = html ? sanitizeCommentHtml(html) : "";
  if (!stripHtmlToText(clean).trim()) return { commentHtml: null, commentJson: null };
  return { commentHtml: clean, commentJson: json ?? null };
}

/**
 * At most one "Added 3 quotes" per book per reading day: the first note of
 * the day records it, later ones add to its counts. Recorded after the write;
 * a failure here never fails the write.
 */
async function notesEvent(workId: string, kind: NoteKind) {
  try {
    const day = await readingToday();
    const field = kind === "quote" ? "quotes" : "notes";
    const updated = resultRows<{ id: string }>(
      await db.execute(sql`update activity_events
        set metadata = jsonb_set(metadata, array['extra', ${field}], to_jsonb(coalesce((metadata->'extra'->>${field})::int, 0) + 1))
        where entity_type = 'work' and entity_id = ${workId}::uuid and event_key = 'work.notes_added' and metadata->'extra'->>'day' = ${day}
        returning id`),
    );
    if (updated.length) return;
    await db.insert(activityEvents).values({
      entityType: "work",
      entityId: workId,
      eventKey: "work.notes_added",
      metadata: { extra: { day, quotes: kind === "quote" ? 1 : 0, notes: kind === "note" ? 1 : 0 } },
    });
  } catch (err) {
    console.error("[activity] Failed to record event: work.notes_added", err);
  }
}

/** Adds a quote or a note; the percent comes from the page when not given */
export async function createReadingNote(input: z.input<typeof createReadingNoteSchema>): Promise<NoteItem> {
  const data = createReadingNoteSchema.parse(input);
  await requireBookWork(data.workId);
  const refs = await references(data.workId, data.readingId, data.editionId);
  const percent = data.percent ?? (data.page != null ? percentOf({ page: data.page }, { totalPages: refs.totalPages, totalMinutes: null }) : null);
  const id = crypto.randomUUID();
  await withReadableErrors(() =>
    atomic((d) => [
      d.insert(readingNotes).values({
        id,
        workId: data.workId,
        readingId: refs.reading?.id ?? null,
        editionId: refs.editionId,
        kind: data.kind,
        body: data.body,
        ...thought(data.kind, data.commentHtml, data.commentJson),
        page: data.page ?? null,
        chapter: data.chapter || null,
        percent,
        isFavourite: data.isFavourite ?? false,
        source: "manual",
      }),
    ]),
  );
  await notesEvent(data.workId, data.kind);
  changed();
  return (await loadNote(id))!;
}

/** Edits a quote or note; a quote that becomes a note loses its thought, and a thought not sent stays as it is */
export async function updateReadingNote(input: z.input<typeof updateReadingNoteSchema>): Promise<NoteItem> {
  const { id, ...patch } = updateReadingNoteSchema.parse(input);
  const note = await noteOrThrow(id);
  const kind = patch.kind ?? note.kind;
  // Another reading brings its edition, unless one is sent; the same reading keeps the note's
  const readingChanged = patch.readingId !== undefined && patch.readingId !== note.readingId;
  const refs = await references(
    note.workId,
    patch.readingId === undefined ? note.readingId : patch.readingId,
    patch.editionId !== undefined ? patch.editionId : readingChanged ? undefined : note.editionId,
  );
  const values: Partial<typeof readingNotes.$inferInsert> = { kind, readingId: refs.reading?.id ?? null, editionId: refs.editionId };
  if (patch.body !== undefined) values.body = patch.body;
  if (patch.chapter !== undefined) values.chapter = patch.chapter || null;
  if (patch.page !== undefined) values.page = patch.page;
  if (patch.percent !== undefined) values.percent = patch.percent;
  else if (patch.page !== undefined)
    values.percent = patch.page != null ? percentOf({ page: patch.page }, { totalPages: refs.totalPages, totalMinutes: null }) : null;
  if (patch.isFavourite !== undefined) values.isFavourite = patch.isFavourite;
  if (kind === "note") Object.assign(values, { commentHtml: null, commentJson: null });
  else if (patch.commentHtml !== undefined || patch.commentJson !== undefined)
    Object.assign(values, thought(kind, patch.commentHtml ?? null, patch.commentJson ?? null));
  await withReadableErrors(() =>
    atomic((d) => [d.update(readingNotes).set({ ...values, updatedAt: new Date() }).where(eq(readingNotes.id, id))]),
  );
  changed();
  return (await loadNote(id))!;
}

/** Stars or unstars a quote or note; a star counts as an edit for an import's undo */
export async function toggleNoteFavourite(input: z.input<typeof noteIdSchema>) {
  const { id } = noteIdSchema.parse(input);
  const note = await noteOrThrow(id);
  await withReadableErrors(() =>
    atomic((d) => [d.update(readingNotes).set({ isFavourite: !note.isFavourite, updatedAt: new Date() }).where(eq(readingNotes.id, id))]),
  );
  changed();
  return { id, isFavourite: !note.isFavourite };
}

/** Deletes a quote or note; the snapshot lets the page undo it */
export async function deleteReadingNote(input: z.input<typeof noteIdSchema>): Promise<NoteSnapshot> {
  const { id } = noteIdSchema.parse(input);
  const { searchText: _s, ...note } = await noteOrThrow(id);
  await withReadableErrors(() => atomic((d) => [d.delete(readingNotes).where(eq(readingNotes.id, id))]));
  changed();
  return note;
}

/** Puts a deleted note back with the same id; a reading, edition or import gone meanwhile comes back empty */
export async function restoreReadingNote(input: z.input<typeof noteSnapshotSchema>): Promise<NoteItem> {
  const snap = noteSnapshotSchema.parse(input);
  await requireBookWork(snap.workId);
  const [reading] = snap.readingId
    ? await db.select({ id: readings.id }).from(readings).where(sql`${readings.id} = ${snap.readingId} and ${readings.workId} = ${snap.workId}`)
    : [];
  const [edition] = snap.editionId
    ? await db.select({ id: editions.id }).from(editions).where(sql`${editions.id} = ${snap.editionId} and ${editions.workId} = ${snap.workId}`)
    : [];
  const [imported] = snap.importId ? await db.select({ id: imports.id }).from(imports).where(eq(imports.id, snap.importId)) : [];
  await withReadableErrors(() =>
    atomic((d) => [
      d.insert(readingNotes).values({
        ...snap,
        readingId: reading?.id ?? null,
        editionId: edition?.id ?? null,
        importId: imported?.id ?? null,
        commentHtml: snap.kind === "quote" ? snap.commentHtml : null,
        commentJson: snap.kind === "quote" ? (snap.commentJson ?? null) : null,
      }),
    ]),
  );
  changed();
  return (await loadNote(snap.id))!;
}

/** A book's quotes and notes, by page and then the order added; each with its reading's number */
export async function getNotesForWork(workId: string): Promise<NoteItem[]> {
  const id = z.uuid().parse(workId);
  return resultRows<NoteItem>(
    await db.execute(sql`select ${NOTE_COLUMNS} from reading_notes n where n.work_id = ${id}::uuid
      order by n.page asc nulls last, n.percent asc nulls last, n.created_at asc, n.id asc`),
  );
}

/** The commonplace book: search, filters, sort and one page (48 by default) */
export async function searchNotes(input: z.input<typeof searchNotesSchema>) {
  const query = searchNotesSchema.parse(input);
  const haystack = sql`n.search_text`;
  const condition = notesCondition(query);
  const where = condition ? sql`where ${condition}` : sql``;
  const direction = sql.raw(query.order === "asc" ? "asc" : query.order === "desc" ? "desc" : query.sort === "book" ? "asc" : "desc");
  const order =
    query.sort === "book"
      ? sql`w.title ${direction}, w.id asc, n.page asc nulls last, n.percent asc nulls last, n.created_at asc, n.id asc`
      : query.sort === "relevance" && query.q && textSearchCondition(haystack, query.q)
        ? sql`${textSearchRank(haystack, sql`left(n.body, 300)`, query.q!)} desc, n.created_at desc, n.id asc`
        : sql`n.created_at ${direction}, n.id asc`;
  const offset = (query.page - 1) * query.perPage;
  const rows = resultRows<NoteWithBook & { total: number }>(
    await db.execute(sql`select ${NOTE_COLUMNS}, ${BOOK_COLUMN}, count(*) over ()::int as total
      from reading_notes n join works w on w.id = n.work_id ${where}
      order by ${order} limit ${query.perPage} offset ${offset}`),
  );
  let total = rows[0]?.total ?? 0;
  // A page past the end still says how many there are
  if (!rows.length && query.page > 1)
    [{ total }] = resultRows<{ total: number }>(
      await db.execute(sql`select count(*)::int as total from reading_notes n join works w on w.id = n.work_id ${where}`),
    );
  return {
    items: rows.map(({ total: _t, ...row }) => row as NoteWithBook),
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / query.perPage)),
  };
}

/** The filters' choices: the books, authors and years that have notes */
export async function getNotesFacets() {
  const [row] = resultRows<{
    total: number;
    books: { id: string; title: string; count: number }[];
    authors: { id: string; name: string }[];
    years: number[];
  }>(
    await db.execute(sql`select (select count(*)::int from reading_notes) as total,
      coalesce((select jsonb_agg(b order by b.title) from (select w.id, w.title, count(*)::int as count
        from reading_notes n join works w on w.id = n.work_id group by w.id, w.title) b), '[]'::jsonb) as books,
      coalesce((select jsonb_agg(x order by x.name) from (select distinct a.id, a.name
        from reading_notes n join work_authors wa on wa.work_id = n.work_id join authors a on a.id = wa.author_id) x), '[]'::jsonb) as authors,
      coalesce((select jsonb_agg(y.year order by y.year desc) from (select distinct extract(year from n.created_at at time zone ${appTimeZone()})::int as year
        from reading_notes n) y), '[]'::jsonb) as years`),
  );
  return row ?? { total: 0, books: [], authors: [], years: [] };
}

/**
 * The passage of the day: one of his quotes, chosen by `choosePassage`;
 * `offset` is the hub's "Another", counted in the browser only. Null
 * without quotes.
 */
export async function getPassageOfTheDay(input: z.input<typeof passageSchema>): Promise<{ note: NoteWithBook; candidates: number } | null> {
  const { day, offset } = passageSchema.parse(input);
  const quotes = await db
    .select({ id: readingNotes.id, isFavourite: readingNotes.isFavourite })
    .from(readingNotes)
    .where(eq(readingNotes.kind, "quote"));
  const chosen = choosePassage(quotes, day, offset ?? 0);
  if (!chosen) return null;
  const [note] = resultRows<NoteWithBook>(
    await db.execute(sql`select ${NOTE_COLUMNS}, ${BOOK_COLUMN} from reading_notes n where n.id = ${chosen.id}::uuid`),
  );
  return note ? { note, candidates: passageCandidates(quotes).length } : null;
}

