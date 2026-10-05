import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_NOTES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln453_reading_notes")
    throw new Error("Quotes and notes tests require a disposable local sln453_reading_notes database");
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, prop) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, prop);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// No S3 in this suite (the import's raw file is the route's): a deleted book's files are never looked for
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import {
  createReadingNote,
  deleteReadingNote,
  getNotesForWork,
  getPassageOfTheDay,
  restoreReadingNote,
  searchNotes,
  toggleNoteFavourite,
  updateReadingNote,
} from "@/lib/actions/reading-notes";
import { deleteReading, getReadingCounts, restoreReading, startReading } from "@/lib/actions/reading";
import { deleteEdition, updateEdition } from "@/lib/actions/editions";
import { deleteWork } from "@/lib/actions/works";
import { moveToExistingEdition } from "@/lib/actions/identify";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { loadReading } from "@/lib/reading/service";
import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import { commitImport, createReadingImport, decideRow, undoImport } from "@/lib/reading/import/store";
import { decideAllNotes, decideNote, getImportNotes } from "@/lib/reading/import/notes";
import { getImportPreview } from "@/lib/reading/import/page-data";
import { commitWords } from "@/lib/reading/import/preview-text";

/* Quotes and notes against PostgreSQL (SLN-453). */

describe.skipIf(!url)("quotes and notes with PostgreSQL", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await q(`truncate works, authors, locations, activity_events, imports cascade`);
  });

  let serial = 0;
  const book = async (title: string, kind = "book") =>
    value(`insert into works(title, slug, kind, original_language) values ($1, $2, $3::text::work_kind_enum, case when $3::text = 'book' then 'en' end) returning id`, [
      title,
      `${title.toLowerCase().replace(/\W+/g, "-")}-${++serial}`,
      kind,
    ]);
  const edition = async (workId: string, pages: number | null = 480) =>
    value(`insert into editions(work_id, title, language, page_count) values ($1, 'E', 'en', $2) returning id`, [workId, pages]);
  async function author(workId: string, name: string) {
    const authorId =
      (await value(`select id from authors where name = $1`, [name])) ??
      (await value(`insert into authors(name, slug) values ($1, $2) returning id`, [name, `${name.toLowerCase().replace(/\W+/g, "-")}-${++serial}`]));
    await q(`insert into work_authors(work_id, author_id, role) values ($1, $2, 'author')`, [workId, authorId]);
    return authorId;
  }
  const finished = async (workId: string, finishedOn = "2019-05-01") =>
    value(`insert into readings(work_id, status, started_precision, finished_on, finished_precision) values ($1, 'finished', 'unknown', $2, 'day') returning id`, [
      workId,
      finishedOn,
    ]);
  const fp = async (id: string) => (await loadReading(id))!.fingerprint;

  describe("books only, and the guard", () => {
    it("refuses a film, a perfume and a painting, by the action and by the trigger", async () => {
      for (const kind of ["film", "perfume", "painting"]) {
        const w = await book(`Not a book ${kind}`, kind);
        await expect(createReadingNote({ workId: w, kind: "quote", body: "Words" })).rejects.toThrow(/(?:Book|Work) not found/);
        await expect(q(`insert into reading_notes(work_id, kind, body) values ($1, 'quote', 'Words')`, [w])).rejects.toMatchObject({
          code: "23514",
          constraint_name: "book_parent_required",
        });
      }
    });

    it("refuses a reading or an edition of another book, and a thought on a note", async () => {
      const [a, b] = [await book("Nadja"), await book("Watt")];
      const rb = await finished(b);
      const eb = await edition(b);
      await expect(createReadingNote({ workId: a, kind: "quote", body: "x", readingId: rb })).rejects.toThrow("This reading belongs to another book");
      await expect(createReadingNote({ workId: a, kind: "quote", body: "x", editionId: eb })).rejects.toThrow("This edition belongs to another book");
      await expect(q(`insert into reading_notes(work_id, reading_id, kind, body) values ($1, $2, 'quote', 'x')`, [a, rb])).rejects.toMatchObject({
        code: "23514",
        constraint_name: "reading_note_reading_work",
      });
      await expect(q(`insert into reading_notes(work_id, edition_id, kind, body) values ($1, $2, 'quote', 'x')`, [a, eb])).rejects.toMatchObject({
        code: "23514",
        constraint_name: "reading_note_edition_work",
      });
      await expect(q(`insert into reading_notes(work_id, kind, body, comment_html) values ($1, 'note', 'x', '<p>Why</p>')`, [a])).rejects.toMatchObject({
        constraint_name: "reading_note_comment_check",
      });
      await expect(createReadingNote({ workId: a, kind: "note", body: "x", commentHtml: "<p>Why</p>" })).rejects.toThrow("Only a quote carries a thought");
    });

    it("lets the audited merge move a quote with its reading and sessions, and refuses a direct move", async () => {
      const [s, t] = [await book("Source"), await book("Target")];
      const reading = await startReading({ workId: s, startedOn: "2026-09-01", startedPrecision: "day", timeZone: "Europe/Amsterdam" });
      await q(`insert into reading_sessions(reading_id, format, read_on, time_zone, end_page) values ($1, 'print', '2026-09-02', 'Europe/Amsterdam', 40)`, [reading.id]);
      const note = await createReadingNote({ workId: s, kind: "quote", body: "Beauty will be convulsive", readingId: reading.id, page: 40 });
      const preview = await previewMerge("works", s, t);
      expect(preview.blockers).toEqual([]);
      await executeMerge({
        entity: "works",
        sourceId: s,
        targetId: t,
        fingerprint: preview.fingerprint,
        choices: Object.fromEntries(preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target"])),
      });
      expect(await q(`select work_id, reading_id from reading_notes where id = $1`, [note.id])).toEqual([{ work_id: t, reading_id: reading.id }]);
      expect(await value(`select work_id from readings where id = $1`, [reading.id])).toBe(t);
      expect(await value(`select count(*)::int from reading_sessions s join readings r on r.id = s.reading_id where r.work_id = $1`, [t])).toBe(1);
      const other = await book("Other");
      await expect(q(`update reading_notes set work_id = $1 where id = $2`, [other, note.id])).rejects.toMatchObject({ constraint_name: "reading_note_reading_work" });
    });
  });

  describe("keeping notes consistent", () => {
    it("clears a moved or deleted edition, carries a placeholder's, and goes with its book", async () => {
      const [a, other] = [await book("A"), await book("Other")];
      const [e1, e2] = [await edition(a), await edition(a)];
      const moved = await createReadingNote({ workId: a, kind: "quote", body: "Moved", editionId: e1, page: 12 });
      const deleted = await createReadingNote({ workId: a, kind: "note", body: "Deleted", editionId: e2 });
      await updateEdition(e1, { workId: other });
      expect(await q(`select work_id, edition_id, page from reading_notes where id = $1`, [moved.id])).toEqual([{ work_id: a, edition_id: null, page: 12 }]);
      await deleteEdition(e2);
      expect(await value(`select edition_id from reading_notes where id = $1`, [deleted.id])).toBeNull();
      // A placeholder edition replaced by the real one
      const p = await book("Placeholder");
      const placeholderId = await value(`insert into editions(work_id, title, language, metadata_source) values ($1, 'P', 'en', 'phantom_canon') returning id`, [p]);
      const real = await value(`insert into editions(work_id, title, language, isbn_13, page_count) values ($1, 'R', 'en', '9780000000002', 300) returning id`, [p]);
      const carried = await createReadingNote({ workId: p, kind: "quote", body: "Carried", editionId: placeholderId });
      await moveToExistingEdition(placeholderId, real);
      expect(await value(`select edition_id from reading_notes where id = $1`, [carried.id])).toBe(real);
      // A deleted book takes its notes
      await deleteWork(p);
      expect(await value(`select count(*)::int from reading_notes where work_id = $1`, [p])).toBe(0);
    });

    it("keeps a deleted reading's notes on the book and links them back on Undo", async () => {
      const a = await book("Nadja");
      const readingId = await finished(a);
      const [one, two] = [
        await createReadingNote({ workId: a, kind: "quote", body: "One", readingId }),
        await createReadingNote({ workId: a, kind: "note", body: "Two", readingId }),
      ];
      expect(await getReadingCounts(a)).toEqual({ readings: 1, sessions: 0, quotes: 1, notes: 1 });
      const snapshot = await deleteReading({ readingId, fingerprint: await fp(readingId) });
      expect(snapshot.noteIds.sort()).toEqual([one.id, two.id].sort());
      expect(await q(`select reading_id from reading_notes where work_id = $1`, [a])).toEqual([{ reading_id: null }, { reading_id: null }]);
      await restoreReading(JSON.parse(JSON.stringify(snapshot)));
      expect((await getNotesForWork(a)).map((n) => [n.body, n.readingId, n.readingOrdinal])).toEqual([
        ["One", readingId, 1],
        ["Two", readingId, 1],
      ]);
    });
  });

  describe("writing", () => {
    it("creates, edits, stars, deletes and restores with the same id; the percent comes from the page", async () => {
      const a = await book("Nadja");
      const reading = await startReading({ workId: a, totalPages: 480, startedOn: "2026-09-01", startedPrecision: "day", timeZone: "Europe/Amsterdam" });
      const note = await createReadingNote({
        workId: a,
        kind: "quote",
        body: "  Beauty will be convulsive or will not be at all.  ",
        readingId: reading.id,
        page: 240,
        chapter: "III",
        commentHtml: "<p><strong>The</strong> last line<script>alert(1)</script></p>",
        commentJson: { type: "doc" },
      });
      expect(note).toMatchObject({ body: "Beauty will be convulsive or will not be at all.", page: 240, percent: 50, chapter: "III", readingOrdinal: 1, source: "manual" });
      expect(note.commentHtml).toBe("<p><strong>The</strong> last line</p>");
      const edited = await updateReadingNote({ id: note.id, page: 120, kind: "note" });
      expect(edited).toMatchObject({ page: 120, percent: 25, kind: "note", commentHtml: null, commentJson: null });
      expect(await toggleNoteFavourite({ id: note.id })).toEqual({ id: note.id, isFavourite: true });
      const snapshot = await deleteReadingNote({ id: note.id });
      expect(await getNotesForWork(a)).toEqual([]);
      const back = await restoreReadingNote(JSON.parse(JSON.stringify(snapshot)));
      expect(back).toMatchObject({ id: note.id, page: 120, isFavourite: true, readingId: reading.id });
      // An empty thought is no thought
      const empty = await createReadingNote({ workId: a, kind: "quote", body: "Q", commentHtml: "<p></p>", commentJson: { type: "doc" } });
      expect(empty.commentHtml).toBeNull();
    });

    it("records one notes event per book per reading day", async () => {
      const a = await book("Nadja");
      for (const body of ["One", "Two", "Three"]) await createReadingNote({ workId: a, kind: "quote", body });
      await createReadingNote({ workId: a, kind: "note", body: "Mine" });
      const events = await q(`select metadata from activity_events where event_key = 'work.notes_added' and entity_id = $1`, [a]);
      expect(events).toHaveLength(1);
      expect(events[0].metadata).toMatchObject({ extra: { quotes: 3, notes: 1 } });
    });
  });

  describe("the commonplace book", () => {
    it("finds a passage without accents or with a typo, filters, sorts, and pages by 48", async () => {
      const [a, b] = [await book("Les Fleurs du mal"), await book("Spleen de Paris")];
      const baudelaire = await author(a, "Charles Baudelaire");
      await author(b, "Charles Baudelaire");
      const c = await book("Watt");
      const beckett = await author(c, "Samuel Beckett");
      const mel = await createReadingNote({ workId: a, kind: "quote", body: "Ô mélancolie des soirs d'automne", page: 30 });
      await createReadingNote({ workId: a, kind: "quote", body: "Le poète est semblable", page: 12, isFavourite: true });
      await createReadingNote({ workId: b, kind: "note", body: "Read it in one sitting" });
      await createReadingNote({ workId: c, kind: "quote", body: "Nothing is more real than nothing", isFavourite: true });
      const titles = async (input: Parameters<typeof searchNotes>[0]) => (await searchNotes(input)).items.map((n) => n.body);
      expect(await titles({ q: "melancolie" })).toEqual([mel.body]);
      expect(await titles({ q: "melancolio" })).toEqual([mel.body]);
      expect(await titles({ workId: b })).toEqual(["Read it in one sitting"]);
      expect((await titles({ authorId: baudelaire })).sort()).toEqual(["Le poète est semblable", "Read it in one sitting", mel.body].sort());
      expect(await titles({ authorId: beckett })).toEqual(["Nothing is more real than nothing"]);
      expect(await titles({ kind: "note" })).toEqual(["Read it in one sitting"]);
      expect((await titles({ favourites: true })).sort()).toEqual(["Le poète est semblable", "Nothing is more real than nothing"]);
      await q(`update reading_notes set created_at = '2024-06-01T12:00:00Z' where id = $1`, [mel.id]);
      expect(await titles({ year: 2024 })).toEqual([mel.body]);
      // Newest first; by book: the titles, then each book's pages
      expect((await titles({ sort: "newest" })).at(-1)).toBe(mel.body);
      expect(await titles({ sort: "book" })).toEqual(["Le poète est semblable", mel.body, "Read it in one sitting", "Nothing is more real than nothing"]);
      expect((await searchNotes({ sort: "book" })).items[0].book).toMatchObject({ title: "Les Fleurs du mal", author: "Charles Baudelaire" });
      await q(`insert into reading_notes(work_id, kind, body) select $1, 'note', 'Filler ' || n from generate_series(1, 46) n`, [c]);
      const first = await searchNotes({ page: 1 });
      expect([first.items.length, first.total, first.pageCount]).toEqual([48, 50, 2]);
      expect((await searchNotes({ page: 2 })).items).toHaveLength(2);
      expect(await searchNotes({ page: 3 })).toMatchObject({ items: [], total: 50 });
    });

    it("gives the same passage all day and another the next day", async () => {
      const a = await book("Nadja");
      for (const body of ["One", "Two", "Three"]) await createReadingNote({ workId: a, kind: "quote", body });
      await createReadingNote({ workId: a, kind: "note", body: "Not a passage" });
      const today = await getPassageOfTheDay({ day: "2026-10-05" });
      expect(today?.candidates).toBe(3);
      expect((await getPassageOfTheDay({ day: "2026-10-05" }))?.note.id).toBe(today?.note.id);
      expect((await getPassageOfTheDay({ day: "2026-10-06" }))?.note.id).not.toBe(today?.note.id);
      // "Another" is the next day's order, without changing the day
      expect((await getPassageOfTheDay({ day: "2026-10-05", offset: 1 }))?.note.id).toBe((await getPassageOfTheDay({ day: "2026-10-06" }))?.note.id);
      expect(today?.note.book.title).toBe("Nadja");
      await q(`delete from reading_notes where kind = 'quote'`);
      expect(await getPassageOfTheDay({ day: "2026-10-05" })).toBeNull();
    });
  });

  describe("Goodreads private notes", () => {
    function goodreads(rows: Record<string, string>[]) {
      const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      return [GOODREADS_EXPORT_HEADER.join(","), ...rows.map((r) => GOODREADS_EXPORT_HEADER.map((h) => cell(r[h] ?? "")).join(","))].join("\n");
    }
    const rowsOf = async (importId: string) =>
      (await q(`select row_no, match->>'section' as section, decision, note_decision, written from reading_import_rows where import_id = $1 order by row_no`, [
        importId,
      ])) as unknown as { row_no: number; section: string; decision: string; note_decision: string; written: { readings: unknown[]; noteIds?: string[] } | null }[];
    const notes = () => q(`select w.title, n.kind, n.body, n.source, n.source_key, n.reading_id, n.import_id from reading_notes n join works w on w.id = n.work_id order by w.title`);

    async function library() {
      const watt = await book("Watt");
      await author(watt, "Samuel Beckett");
      await q(`insert into editions(work_id, title, language, goodreads_id) values ($1, 'Watt', 'en', '1111')`, [watt]);
      const nadja = await book("Nadja");
      await author(nadja, "André Breton");
      await q(`insert into editions(work_id, title, language, isbn_13) values ($1, 'Nadja', 'fr', '9782070360260')`, [nadja]);
      const nadjaRead = await finished(nadja, "2019-05-01");
      const curee = await book("La Curée");
      await author(curee, "Émile Zola");
      const moby = await book("Moby-Dick");
      await author(moby, "Herman Melville");
      await q(`insert into editions(work_id, title, language, goodreads_id) values ($1, 'Moby-Dick', 'en', '2222')`, [moby]);
      const file = goodreads([
        { "Book Id": "1111", Title: "Watt", Author: "Samuel Beckett", "Exclusive Shelf": "read", "Date Read": "2020/02/02", "Read Count": "1", "Private Notes": "Lent to Ana<br/>Read it twice" },
        { Title: "Nadja", Author: "André Breton", ISBN13: '="9782070360260"', "Exclusive Shelf": "read", "Date Read": "2019/05/01", "Read Count": "1", "Private Notes": "Breton's walk" },
        { Title: "La Curée", Author: "Émile Zola", "Exclusive Shelf": "read", "Date Read": "2021/03/03", "Read Count": "1", "Private Notes": "The hothouse scene" },
        { "Book Id": "2222", Title: "Moby-Dick", Author: "Herman Melville", "Exclusive Shelf": "read", "Date Read": "2018/01/01", "Read Count": "1", "Private Notes": "x".repeat(12_400) },
        { Title: "Not in Durtal", Author: "Nobody", "Exclusive Shelf": "read", "Date Read": "2017/01/01", "Read Count": "1", "Private Notes": "No book" },
      ]);
      return { file, watt, nadja, nadjaRead, curee };
    }

    it("lists, decides, commits, re-commits and undoes private notes", async () => {
      const { file, nadjaRead } = await library();
      const { importId } = await createReadingImport({ text: file, fileName: "goodreads.csv" });
      expect((await rowsOf(importId)).map((r) => [r.section, r.decision, r.note_decision])).toEqual([
        ["exact", "import", "import"],
        ["present", "skip", "pending"],
        ["likely", "pending", "pending"],
        ["exact", "import", "import"],
        ["none", "pending", "pending"],
      ]);
      const listed = await getImportNotes(importId, 50);
      expect(listed.count).toBe(5);
      expect(listed.rows.map((r) => [r.title, r.state])).toEqual([
        ["Watt", "import"],
        ["Nadja", "pending"],
        ["La Curée", "pending"],
        ["Moby-Dick", "too_long"],
        ["Not in Durtal", "no_book"],
      ]);
      expect(listed.rows[0].preview).toBe("Lent to Ana\nRead it twice");
      expect(listed.rows[3].preview.length).toBeLessThan(12_400);
      expect(listed.toImport).toBe(1);
      const preview = (await getImportPreview(importId))!;
      expect(commitWords(preview.summary.toImport, preview.summary.pending, preview.summary.toQueue, listed.toImport).label).toBe("Import 2 readings and 1 note");

      // A row whose reads are already in Durtal still brings its note; a row without a book cannot
      await decideNote({ importId, rowNo: 2, decision: "import" });
      await expect(decideNote({ importId, rowNo: 5, decision: "import" })).rejects.toThrow("Choose this row's book first");
      expect(await decideAllNotes(importId)).toEqual({ changed: 1 });
      expect((await rowsOf(importId)).map((r) => r.note_decision)).toEqual(["import", "import", "import", "import", "pending"]);

      const result = await commitImport(importId);
      expect(result).toMatchObject({ written: 2, notes: 3, notesPresent: 0 });
      const after = await notes();
      expect(after.map((n) => [n.title, n.kind, n.source, n.body])).toEqual([
        ["La Curée", "note", "import", "The hothouse scene"],
        ["Nadja", "note", "import", "Breton's walk"],
        ["Watt", "note", "import", "Lent to Ana\nRead it twice"],
      ]);
      expect(after.map((n) => String(n.source_key).split(":").slice(0, 2).join(":"))).toEqual(["goodreads-note:title", "goodreads-note:isbn13", "goodreads-note:1111"]);
      expect(after.every((n) => n.import_id === importId)).toBe(true);
      // Watt: the reading this commit wrote; Nadja: the reading already there; La Curée: its readings were not decided
      const wattRead = await value(`select r.id from readings r join works w on w.id = r.work_id where w.title = 'Watt'`);
      expect(after.map((n) => n.reading_id)).toEqual([null, nadjaRead, wattRead]);
      const rows = await rowsOf(importId);
      expect(rows.map((r) => r.written?.noteIds?.length ?? 0)).toEqual([1, 1, 1, 0, 0]);
      expect(rows[2].written?.readings).toEqual([]);
      expect((await getImportNotes(importId, 50)).rows.map((r) => r.state)).toEqual(["imported", "imported", "imported", "too_long", "no_book"]);
      await expect(decideNote({ importId, rowNo: 1, decision: "skip" })).rejects.toThrow("This note was imported; undo the import to change it");

      // La Curée's note is in; its readings can still be decided and committed
      await decideRow({ importId, rowNo: 3, decision: "import" });
      expect(await commitImport(importId)).toMatchObject({ written: 1, notes: 0 });
      const curee = (await rowsOf(importId))[2];
      expect([curee.written?.readings.length, curee.written?.noteIds?.length]).toEqual([1, 1]);

      // The same file uploaded again writes no note
      const again = await createReadingImport({ text: file, fileName: "goodreads.csv" });
      await decideAllNotes(again.importId);
      expect((await getImportNotes(again.importId, 50)).rows.map((r) => r.state)).toEqual(["present", "present", "present", "too_long", "no_book"]);
      expect(await commitImport(again.importId)).toMatchObject({ notes: 0, notesPresent: 3 });
      expect(await notes()).toHaveLength(3);

      // Undo: unedited notes go, an edited one stays
      const watt = after.find((n) => n.title === "Watt")!;
      const wattNote = await value(`select id from reading_notes where source_key = $1`, [watt.source_key]);
      await updateReadingNote({ id: wattNote, body: "Lent to Ana, never returned" });
      expect(await undoImport(importId)).toMatchObject({ notesRemoved: 2, notesKept: 1 });
      expect((await notes()).map((n) => n.body)).toEqual(["Lent to Ana, never returned"]);
      expect((await rowsOf(importId)).every((r) => !r.written?.noteIds)).toBe(true);
      // Committed again, the notes come back, except the kept one's key
      expect(await commitImport(importId)).toMatchObject({ notes: 2, notesPresent: 1 });
    });

    it("imports only the notes of an import committed before notes existed", async () => {
      const { file } = await library();
      const { importId } = await createReadingImport({ text: file, fileName: "goodreads.csv" });
      // An import from before this step: every note waits, and its readings are in
      await q(`update reading_import_rows set note_decision = default where import_id = $1`, [importId]);
      expect(await commitImport(importId)).toMatchObject({ written: 2, notes: 0 });
      const readings = await value<number>(`select count(*)::int from readings`);
      expect((await getImportNotes(importId, 50)).rows.map((r) => r.state)).toEqual(["pending", "pending", "pending", "too_long", "no_book"]);
      await decideAllNotes(importId);
      expect(await commitImport(importId)).toMatchObject({ written: 0, notes: 3 });
      expect(await value<number>(`select count(*)::int from readings`)).toBe(readings);
    });
  });
});
