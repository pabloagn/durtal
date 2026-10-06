import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_QUOTE_EDITIONS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln480_quote_editions")
    throw new Error("Quote edition tests require a disposable local sln480_quote_editions database");
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
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import { createReadingNote, deleteReadingNote, getNotesFacets, getNotesForWork, getPersonNoteCounts, restoreReadingNote, searchNotes, updateReadingNote } from "@/lib/actions/reading-notes";
import { getReadingsForWork, updateReading } from "@/lib/actions/reading";
import { deleteEdition, updateEdition } from "@/lib/actions/editions";
import { moveToExistingEdition } from "@/lib/actions/identify";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { loadReading } from "@/lib/reading/service";
import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import { commitImport, createReadingImport } from "@/lib/reading/import/store";
import { decideAllNotes } from "@/lib/reading/import/notes";
import { GET as listNotes, POST as postNote } from "@/app/api/readings/notes/route";
import { DELETE as deleteNote, GET as getNote, PATCH as patchNote } from "@/app/api/readings/notes/[id]/route";

/* Quotes tied to editions, with page numbers (SLN-480), against PostgreSQL. */

const TOKEN = "test-quote-editions-token";

function request(method: string, path: string, body?: unknown, token: string | null = TOKEN) {
  return new NextRequest(`http://local${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function answer(res: Response) {
  return { status: res.status, body: await res.json() };
}

describe.skipIf(!url)("quotes tied to editions with PostgreSQL", () => {
  const q = (text: string, values: unknown[] = []) => client!.unsafe(text, values as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, values: unknown[] = []) => Object.values((await q(text, values))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    vi.stubEnv("DURTAL_API_TOKEN", TOKEN);
    await q(`truncate works, authors, locations, activity_events, imports cascade`);
  });

  let serial = 0;
  const book = async (title: string) =>
    value(`insert into works(title, slug, kind, original_language) values ($1, $2, 'book', 'en') returning id`, [
      title,
      `${title.toLowerCase().replace(/\W+/g, "-")}-${++serial}`,
    ]);
  const edition = async (workId: string, over: { pages?: number | null; year?: number | null; isbn13?: string; publisher?: string; title?: string } = {}) =>
    value(`insert into editions(work_id, title, language, page_count, publication_year, isbn_13, publisher) values ($1, $6, 'en', $2, $3, $4, $5) returning id`, [
      workId,
      over.pages === undefined ? 480 : over.pages,
      over.year ?? null,
      over.isbn13 ?? null,
      over.publisher ?? null,
      over.title ?? "E",
    ]);
  async function person(name: string) {
    return (
      (await value(`select id from authors where name = $1`, [name])) ??
      (await value(`insert into authors(name, slug) values ($1, $2) returning id`, [name, `${name.toLowerCase().replace(/\W+/g, "-")}-${++serial}`]))
    );
  }
  const translator = async (editionId: string, name: string) => {
    const id = await person(name);
    await q(`insert into edition_contributors(edition_id, author_id, role) values ($1, $2, 'translator')`, [editionId, id]);
    return id;
  };
  const reading = async (workId: string, editionId: string | null, totalPages: number | null = null, status = "reading") =>
    value(`insert into readings(work_id, edition_id, status, total_pages, started_precision, finished_precision) values ($1, $2, $3, $4, 'unknown', 'unknown') returning id`, [
      workId,
      editionId,
      status,
      totalPages,
    ]);
  const fp = async (id: string) => (await loadReading(id))!.fingerprint;
  const row = (id: string) =>
    q(`select edition_id, page, end_page, page_roman, percent::float8 as percent, updated_at = created_at as unedited from reading_notes where id = $1`, [id]).then((r) => r[0]);

  describe("the edition and the percent", () => {
    it("takes the reading's edition when none is sent, and keeps an edition sent with no reading", async () => {
      const w = await book("Don Quixote");
      const [a, b] = [await edition(w), await edition(w)];
      const r = await reading(w, a, 400);
      expect((await createReadingNote({ workId: w, kind: "quote", body: "x", readingId: r })).editionId).toBe(a);
      expect((await createReadingNote({ workId: w, kind: "quote", body: "y", editionId: b })).editionId).toBe(b);
    });

    it("works the percent out against the note's own edition, and again when the page, edition or reading changes", async () => {
      const w = await book("Don Quixote");
      const a = await edition(w, { pages: 350 });
      const b = await edition(w, { pages: 300 });
      const r = await reading(w, a, 400);
      // The worked example: p. 120 under B (300 pages) is 40.00; moved to A, the reading's own edition (400 pages), 30.00
      const note = await createReadingNote({ workId: w, kind: "quote", body: "Windmills", readingId: r, editionId: b, page: 120 });
      expect(note.percent).toBe(40);
      expect(typeof note.percent).toBe("number");
      expect((await updateReadingNote({ id: note.id, editionId: a })).percent).toBe(30);
      expect((await updateReadingNote({ id: note.id, page: 200 })).percent).toBe(50);
      // No reading: the note keeps its edition, and its percent is of that edition's page count
      expect(await updateReadingNote({ id: note.id, readingId: null })).toMatchObject({ editionId: a, percent: 57.14 });
      // Front matter has no percent; a range's end does not count
      expect((await updateReadingNote({ id: note.id, page: 14, endPage: 16, pageRoman: true })).percent).toBeNull();
      expect((await updateReadingNote({ id: note.id, page: 70, endPage: 71, pageRoman: false })).percent).toBe(20);
      // A snapshot: a new page count changes nothing
      await updateEdition(a, { pageCount: 700 });
      expect((await row(note.id)).percent).toBe(20);
      // A percent-only note keeps its percent when its edition changes
      const pct = await createReadingNote({ workId: w, kind: "quote", body: "z", editionId: a, percent: 44 });
      expect((await updateReadingNote({ id: pct.id, editionId: b })).percent).toBe(44);
    });

    it("refuses a page with a percent, and the page rules, by the action and by the CHECK", async () => {
      const w = await book("Don Quixote");
      const e = await edition(w);
      await expect(createReadingNote({ workId: w, kind: "quote", body: "x", editionId: e, page: 12, percent: 30 })).rejects.toThrow("Send a page or a percent, not both");
      await expect(createReadingNote({ workId: w, kind: "quote", body: "x", editionId: e, page: 12, endPage: 12 })).rejects.toThrow("The last page comes after the first");
      await expect(createReadingNote({ workId: w, kind: "quote", body: "x", editionId: e, page: 0, pageRoman: true })).rejects.toThrow("A roman page starts at i");
      const n = await createReadingNote({ workId: w, kind: "quote", body: "x", editionId: e, page: 12, endPage: 14 });
      await expect(updateReadingNote({ id: n.id, page: 20 })).rejects.toThrow("The last page comes after the first");
      await expect(updateReadingNote({ id: n.id, percent: 30 })).rejects.toThrow("Send a page or a percent, not both");
      for (const values of ["12, 12, false", "null, 13, false", "0, null, true", "null, null, true"])
        await expect(q(`insert into reading_notes(work_id, kind, body, page, end_page, page_roman) values ($1, 'quote', 'x', ${values})`, [w])).rejects.toMatchObject({
          constraint_name: "reading_note_page_range_check",
        });
      // No page: no range and no roman
      expect(await updateReadingNote({ id: n.id, page: null })).toMatchObject({ page: null, endPage: null, pageRoman: false });
      await expect(updateReadingNote({ id: n.id, endPage: 30 })).rejects.toThrow("Send the first page with the last");
      await expect(updateReadingNote({ id: n.id, pageRoman: true })).rejects.toThrow("A roman page starts at i");
      await expect(createReadingNote({ workId: w, kind: "quote", body: "x", editionId: e, endPage: 30 })).rejects.toThrow("Send the first page with the last");
    });

    it("puts a deleted note back with its range and roman pages", async () => {
      const w = await book("Don Quixote");
      const e = await edition(w);
      const n = await createReadingNote({ workId: w, kind: "quote", body: "Preface", editionId: e, page: 14, endPage: 16, pageRoman: true });
      const snapshot = await deleteReadingNote({ id: n.id });
      await restoreReadingNote(JSON.parse(JSON.stringify(snapshot)));
      expect(await row(n.id)).toMatchObject({ edition_id: e, page: 14, end_page: 16, page_roman: true });
    });
  });

  describe("when an edition or a reading changes", () => {
    it("keeps a deleted or moved edition's notes on the book with their pages, and carries a placeholder's", async () => {
      const [w, other] = [await book("Don Quixote"), await book("Other")];
      const [a, b] = [await edition(w), await edition(w)];
      const deleted = await createReadingNote({ workId: w, kind: "quote", body: "x", editionId: a, page: 12 });
      await deleteEdition(a);
      expect(await row(deleted.id)).toMatchObject({ edition_id: null, page: 12 });
      const moved = await createReadingNote({ workId: w, kind: "quote", body: "y", editionId: b, page: 212, endPage: 213 });
      await updateEdition(b, { workId: other });
      expect(await row(moved.id)).toMatchObject({ edition_id: null, page: 212, end_page: 213 });
      expect(await value(`select work_id from reading_notes where id = $1`, [moved.id])).toBe(w);
      const p = await book("Placeholder");
      const placeholder = await value(`insert into editions(work_id, title, language, metadata_source) values ($1, 'P', 'en', 'phantom_canon') returning id`, [p]);
      const real = await value(`insert into editions(work_id, title, language, isbn_13, page_count) values ($1, 'R', 'en', '9780000000002', 300) returning id`, [p]);
      const carried = await createReadingNote({ workId: p, kind: "quote", body: "z", editionId: placeholder, page: 30, percent: undefined });
      const before = await row(carried.id);
      await moveToExistingEdition(placeholder, real);
      expect(await row(carried.id)).toMatchObject({ edition_id: real, page: 30, percent: before.percent });
    });

    it("refiles a reading's notes under its new edition only when asked, and never one naming another edition", async () => {
      const w = await book("Don Quixote");
      const [a, b, c] = [await edition(w), await edition(w), await edition(w)];
      const r = await reading(w, a);
      const own = await createReadingNote({ workId: w, kind: "quote", body: "own", readingId: r, page: 12 });
      const elsewhere = await createReadingNote({ workId: w, kind: "quote", body: "elsewhere", readingId: r, editionId: c, page: 40 });
      expect((await getReadingsForWork(w))[0]).toMatchObject({ quoteCount: 2, ownEditionQuoteCount: 1, ownEditionNoteCount: 0 });
      await updateReading({ readingId: r, fingerprint: await fp(r), editionId: b });
      expect((await row(own.id)).edition_id).toBe(a);
      await updateReading({ readingId: r, fingerprint: await fp(r), editionId: a });
      await updateReading({ readingId: r, fingerprint: await fp(r), editionId: b, moveNotes: true });
      expect(await row(own.id)).toMatchObject({ edition_id: b, page: 12, unedited: true });
      expect((await row(elsewhere.id)).edition_id).toBe(c);
      // From no edition: only the notes with none move
      const r2 = await reading(w, null, null, "finished");
      const none = await createReadingNote({ workId: w, kind: "note", body: "none", readingId: r2 });
      const named = await createReadingNote({ workId: w, kind: "note", body: "named", readingId: r2, editionId: c });
      await updateReading({ readingId: r2, fingerprint: await fp(r2), editionId: a, moveNotes: true });
      expect([(await row(none.id)).edition_id, (await row(named.id)).edition_id]).toEqual([a, c]);
    });

    it("keeps a note's edition and page when its book is merged into another", async () => {
      const [s, t] = [await book("Source"), await book("Target")];
      const e = await edition(s);
      const note = await createReadingNote({ workId: s, kind: "quote", body: "x", editionId: e, page: 212, endPage: 213 });
      const preview = await previewMerge("works", s, t);
      expect(preview.blockers).toEqual([]);
      await executeMerge({
        entity: "works",
        sourceId: s,
        targetId: t,
        fingerprint: preview.fingerprint,
        choices: Object.fromEntries(preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target"])),
      });
      expect(await q(`select work_id, edition_id, page, end_page from reading_notes where id = $1`, [note.id])).toEqual([{ work_id: t, edition_id: e, page: 212, end_page: 213 }]);
      expect(await value(`select work_id from editions where id = $1`, [e])).toBe(t);
    });
  });

  describe("the import", () => {
    it("files an imported note under its reading's edition", async () => {
      const w = await book("Watt");
      await q(`insert into authors(name, slug) values ('Samuel Beckett', 'samuel-beckett')`);
      await q(`insert into work_authors(work_id, author_id, role) select $1, id, 'author' from authors where slug = 'samuel-beckett'`, [w]);
      const e = await value(`insert into editions(work_id, title, language, goodreads_id) values ($1, 'Watt', 'en', '1111') returning id`, [w]);
      const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const fields: Record<string, string> = { "Book Id": "1111", Title: "Watt", Author: "Samuel Beckett", "Exclusive Shelf": "read", "Date Read": "2020/02/02", "Read Count": "1", "Private Notes": "Lent to Ana" };
      const file = [GOODREADS_EXPORT_HEADER.join(","), GOODREADS_EXPORT_HEADER.map((h) => cell(fields[h] ?? "")).join(",")].join("\n");
      const { importId } = await createReadingImport({ text: file, fileName: "goodreads.csv" });
      await decideAllNotes(importId);
      await commitImport(importId);
      expect(await q(`select n.edition_id, r.edition_id as reading_edition from reading_notes n join readings r on r.id = n.reading_id`)).toEqual([{ edition_id: e, reading_edition: e }]);
    });

    it("backfills an imported note from its reading, leaving updated_at alone", async () => {
      const file = readdirSync("src/lib/db/migrations").find((f) => f.endsWith("_quote_editions.sql"))!;
      const statement = readFileSync(`src/lib/db/migrations/${file}`, "utf8")
        .split("--> statement-breakpoint")
        .find((s) => s.includes("update reading_notes n set edition_id"))!;
      const w = await book("Watt");
      const e = await edition(w);
      const r = await reading(w, e, null, "finished");
      const imported = await value(`insert into reading_notes(work_id, reading_id, kind, body, source) values ($1, $2, 'note', 'x', 'import') returning id`, [w, r]);
      const manual = await value(`insert into reading_notes(work_id, reading_id, kind, body, source) values ($1, $2, 'note', 'y', 'manual') returning id`, [w, r]);
      await q(statement);
      expect(await row(imported)).toMatchObject({ edition_id: e, unedited: true });
      expect((await row(manual)).edition_id).toBeNull();
    });
  });

  describe("the commonplace book", () => {
    async function library() {
      const w = await book("Don Quixote");
      const title = "Don Quixote";
      const newer = await edition(w, { year: 2003, publisher: "Ecco", title });
      const undated = await edition(w, { year: null, publisher: "Undated", title });
      const older = await edition(w, { year: 1950, publisher: "Penguin", title });
      const grossman = await translator(newer, "Edith Grossman");
      await translator(older, "J. M. Cohen");
      const n = (body: string, editionId: string | null, place: Record<string, unknown> = {}) =>
        createReadingNote({ workId: w, kind: "quote", body, editionId, ...place });
      await n("newer 40", newer, { page: 40 });
      await n("newer xiv", newer, { page: 14, pageRoman: true });
      await n("older 10", older, { page: 10 });
      await n("undated 5", undated, { page: 5 });
      await n("none 1", null, { page: 1 });
      await n("newer 44%", newer, { percent: 44 });
      return { w, newer, undated, older, grossman };
    }

    it("orders a book's notes in each group: front matter, pages, percents", async () => {
      const { w } = await library();
      expect((await getNotesForWork(w)).filter((x) => x.body.startsWith("newer")).map((x) => x.body)).toEqual(["newer xiv", "newer 40", "newer 44%"]);
    });

    it("filters by edition, by no edition and by translator, and sorts by edition group", async () => {
      const { w, newer, grossman } = await library();
      const bodies = async (input: Parameters<typeof searchNotes>[0]) => (await searchNotes(input)).items.map((x) => x.body);
      expect(await bodies({ editionId: newer, sort: "book" })).toEqual(["newer xiv", "newer 40", "newer 44%"]);
      expect(await bodies({ editionId: "none" })).toEqual(["none 1"]);
      expect(await bodies({ translatorId: grossman, sort: "book" })).toEqual(["newer xiv", "newer 40", "newer 44%"]);
      // No year first (as the Editions section), then newest first, no edition last
      expect(await bodies({ workId: w, sort: "book" })).toEqual(["undated 5", "newer xiv", "newer 40", "newer 44%", "older 10", "none 1"]);
      const result = await searchNotes({ workId: w, sort: "book" });
      expect(result.noteEditions[newer]).toMatchObject({ label: "Ecco, 2003, tr. Edith Grossman", translators: ["Edith Grossman"] });
      expect(result.items.map((x) => [typeof x.percent, typeof x.page])).toContainEqual(["number", "number"]);
      const facets = await getNotesFacets(w);
      expect(facets.editions.map((e) => e.label)).toEqual(["Undated", "Ecco, 2003, tr. Edith Grossman", "Penguin, 1950, tr. J. M. Cohen"]);
      expect([facets.noEdition, facets.translators.map((t) => t.name)]).toEqual([1, ["Edith Grossman", "J. M. Cohen"]]);
      expect(await getPersonNoteCounts(grossman)).toEqual({ quotes: 0, notes: 0, translatedQuotes: 3, translatedNotes: 0 });
    });
  });

  describe("the notes routes", () => {
    async function shelf() {
      const w = await book("The Odyssey");
      const e = await edition(w, { isbn13: "9780140449136", publisher: "Penguin", year: 2003, title: "The Odyssey" });
      await translator(e, "E. V. Rieu");
      return { w, e };
    }

    it("refuses every route without the token (401), and when none is set (503)", async () => {
      const { w } = await shelf();
      const n = await createReadingNote({ workId: w, kind: "quote", body: "x" });
      const calls = (token: string | null) => [
        () => listNotes(request("GET", "/api/readings/notes", undefined, token)),
        () => postNote(request("POST", "/api/readings/notes", { workId: w, body: "y" }, token)),
        () => getNote(request("GET", `/api/readings/notes/${n.id}`, undefined, token), params(n.id)),
        () => patchNote(request("PATCH", `/api/readings/notes/${n.id}`, { page: 3 }, token), params(n.id)),
        () => deleteNote(request("DELETE", `/api/readings/notes/${n.id}`, undefined, token), params(n.id)),
      ];
      for (const call of calls("wrong")) expect((await call()).status).toBe(401);
      vi.stubEnv("DURTAL_API_TOKEN", "");
      for (const call of calls(TOKEN)) expect((await call()).status).toBe(503);
    });

    it("keeps a quote by edition, ISBN-13, ISBN-10 or book, with its citation", async () => {
      const { w, e } = await shelf();
      const byEdition = await answer(await postNote(request("POST", "/api/readings/notes", { editionId: e, body: "Sing to me", page: 77 })));
      expect(byEdition).toMatchObject({ status: 201, body: { message: "Saved a quote from The Odyssey, p. 77" } });
      expect(byEdition.body.note).toMatchObject({ editionId: e, kind: "quote", source: "manual", citation: "The Odyssey, tr. E. V. Rieu (Penguin, 2003), p. 77" });
      for (const isbn of ["9780140449136", "0-14-044913-2"])
        expect(await answer(await postNote(request("POST", "/api/readings/notes", { isbn, body: "x" })))).toMatchObject({ status: 201, body: { note: { editionId: e } } });
      // By book: the only edition; with an open reading, its edition and the reading
      expect((await answer(await postNote(request("POST", "/api/readings/notes", { workId: w, body: "x" })))).body.note.editionId).toBe(e);
      const e2 = await edition(w);
      expect((await answer(await postNote(request("POST", "/api/readings/notes", { workId: w, body: "x" })))).body.note.editionId).toBeNull();
      const r = await reading(w, e2);
      expect((await answer(await postNote(request("POST", "/api/readings/notes", { workId: w, body: "x" })))).body.note).toMatchObject({ editionId: e2, readingId: r });
      expect((await answer(await postNote(request("POST", "/api/readings/notes", { editionId: e, readingId: null, body: "x" })))).body.note.readingId).toBeNull();
      // A named reading files the note under its own edition, not the open one's
      const past = await reading(w, e, 480, "finished");
      expect((await answer(await postNote(request("POST", "/api/readings/notes", { workId: w, readingId: past, body: "x", page: 48 })))).body.note).toMatchObject({ editionId: e, readingId: past, percent: 10 });
      // A named reading with no edition falls back as the book does: here to the open reading's
      const bare = await reading(w, null, null, "finished");
      expect((await answer(await postNote(request("POST", "/api/readings/notes", { workId: w, readingId: bare, body: "x" })))).body.note).toMatchObject({ editionId: e2, readingId: bare });
      // A 979 ISBN has no ISBN-10: an edition with an empty one is not a match
      await q(`update editions set isbn_10 = '' where id = $1`, [e2]);
      expect(await answer(await postNote(request("POST", "/api/readings/notes", { isbn: "9791090636071", body: "x" })))).toMatchObject({ status: 404, body: { message: "Not in Durtal yet" } });
    });

    it("answers 400 and 404 for what it cannot take", async () => {
      const { w, e } = await shelf();
      const other = await book("Other");
      const otherEdition = await edition(other);
      const post = async (body: unknown) => answer(await postNote(request("POST", "/api/readings/notes", body)));
      expect(await post({ body: "x" })).toMatchObject({ status: 400, body: { message: "Send one of editionId, isbn or workId" } });
      expect(await post({ editionId: e, workId: w, body: "x" })).toMatchObject({ status: 400 });
      expect(await post({ isbn: "9780000000019", body: "x" })).toMatchObject({ status: 404, body: { message: "Not in Durtal yet", addUrl: "/library/new?isbn=9780000000019" } });
      expect(await post({ editionId: e, body: "x", page: 12, percent: 20 })).toMatchObject({ status: 400, body: { message: "Send a page or a percent, not both" } });
      // A range or roman numerals with no page are refused, not dropped
      expect(await post({ editionId: e, body: "x", endPage: 13 })).toMatchObject({ status: 400, body: { message: "Send the first page with the last" } });
      expect(await post({ editionId: e, body: "x", pageRoman: true })).toMatchObject({ status: 400, body: { message: "A roman page starts at i" } });
      expect(await post({ editionId: e, body: "x", source: "import" })).toMatchObject({ status: 400 });
      const n = (await post({ editionId: e, body: "x" })).body.note;
      const patch = async (body: unknown) => answer(await patchNote(request("PATCH", `/api/readings/notes/${n.id}`, body), params(n.id)));
      expect(await patch({ editionId: otherEdition })).toMatchObject({ status: 400, body: { message: "This edition belongs to another book" } });
      expect(await patch({ workId: other })).toMatchObject({ status: 400 });
      expect(await patch({ page: 212, endPage: 213 })).toMatchObject({ status: 200, body: { note: { page: 212, endPage: 213 } } });
      expect(await answer(await deleteNote(request("DELETE", `/api/readings/notes/${n.id}`), params(n.id)))).toMatchObject({ status: 200 });
      expect(await answer(await getNote(request("GET", `/api/readings/notes/${n.id}`), params(n.id)))).toMatchObject({ status: 404, body: { message: "This note no longer exists" } });
    });

    it("lists notes with /reading/notes's parameters, the edition included", async () => {
      const { w, e } = await shelf();
      await createReadingNote({ workId: w, kind: "quote", body: "on the edition", editionId: e });
      await createReadingNote({ workId: w, kind: "quote", body: "on none" });
      const res = await answer(await listNotes(request("GET", "/api/readings/notes?edition=none")));
      expect(res).toMatchObject({ status: 200, body: { total: 1, page: 1, pageCount: 1 } });
      expect(res.body.items.map((x: { body: string; edition: unknown }) => [x.body, x.edition])).toEqual([["on none", null]]);
    });
  });
});
