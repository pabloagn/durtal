import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_EBOOK_DIFFERENCES_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln658_ebook_differences");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln658_ebook_differences")
    throw new Error("Differences tests require a disposable local sln658_ebook_differences database");
}
const client = url ? postgres(url, { prepare: false, max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_, prop) => {
    if (!testDb) throw new Error("Local test database required");
    return Reflect.get(testDb, prop);
  } }),
}));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/s3/covers", () => ({ uploadToS3: vi.fn(), getS3Object: vi.fn(), deleteFromS3: vi.fn(), processAndUploadCover: vi.fn() }));
// The cover's bytes are the matching's own stage, tested there; here only its keys land on the edition
vi.mock("@/lib/ebooks/match/covers", () => ({
  planCoverCopy: vi.fn((_s: unknown, ebookId: string, editionId: string, sourceKey: string) => ({ ebookId, editionId, sourceKey })),
  copyPlannedCover: vi.fn(async (plan: { editionId: string }) => ({
    coverKey: `gold/covers/${plan.editionId}/stage.webp`, thumbnailKey: `gold/covers/${plan.editionId}/stage-thumb.webp`, palette: null,
  })),
}));
vi.mock("@/lib/s3/cover-stage", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/s3/cover-stage")>()), retainCoverAttempt: vi.fn() }));
import { getDifferences, decideDifferences, undoDifferences, readDifferenceSides, DIFFERENCE_EVENTS } from "@/lib/ebooks/differences/store";
import { differencesOf, type Difference, type DifferenceField } from "@/lib/ebooks/differences/compare";
import { activitySettled } from "@/lib/activity/record";

/* The Differences section (SLN-658): a library e-book against its book, both
   choices per row and in bulk, their undo, and nothing written without one. */

describe.skipIf(!url)("an e-book's differences with its book", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];

  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln658_ebook_differences");
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  let serial = 0;
  let place: string;
  beforeEach(async () => {
    // The last test's journal writes land before the reset, not in the next test
    await activitySettled();
    await resetDisposableDatabase(url!, "sln658_ebook_differences", { emptyLocations: true });
    place = (await one(`insert into locations(name, type) values ('eBooks', 'digital') returning id`)).id;
  }, 30000);

  interface Fixture {
    title: string; author: string; status?: string; language?: string; year?: number | null; publisher?: string | null;
    isbn13?: string | null; series?: string | null; position?: string | null; cover?: boolean;
    ebook: { title?: string; authors?: string[]; language?: string | null; year?: number | null; publisher?: string | null;
      isbns?: string[]; series?: string | null; seriesIndex?: number | null; cover?: boolean };
    library?: boolean;
  }
  /** A book with its edition and digital copy, and the e-book linked to it */
  async function linked(f: Fixture) {
    const n = ++serial;
    const seriesId = f.series ? (await one(`insert into series(title, slug) values ($1, $2) returning id`, [f.series, `series-${n}`])).id : null;
    const work = (await one(`insert into works(title, slug, catalogue_status, series_id, series_position, original_language)
      values ($1, $2, $3::catalogue_status_enum, $4, $5, 'fr') returning id`, [f.title, `book-${n}`, f.status ?? "accessioned", seriesId, f.position ?? null])).id;
    const author = (await one(`insert into authors(name, slug) values ($1, $2) returning id`, [f.author, `author-${n}`])).id;
    await q(`insert into work_authors(work_id, author_id, role) values ($1, $2, 'author')`, [work, author]);
    const edition = (await one(`insert into editions(work_id, title, language, publication_year, publisher, isbn_13, cover_s3_key, thumbnail_s3_key)
      values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`, [work, f.title, f.language ?? "fr", f.year ?? null, f.publisher ?? null, f.isbn13 ?? null,
      f.cover ? `gold/covers/${n}.webp` : null, f.cover ? `gold/covers/${n}-thumb.webp` : null])).id;
    const copy = (await one(`insert into instances(edition_id, location_id, format) values ($1, $2, 'epub') returning id`, [edition, place])).id;
    const e = f.ebook;
    const ebook = (await one(`insert into ebooks(title, authors, language, published_year, publisher, isbns, series, series_index, cover_key,
        import_source, import_ref, instance_id, match_state, search_text)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'folder', $10, $11, 'linked', '') returning id`, [e.title ?? f.title, e.authors ?? [f.author],
      e.language ?? null, e.year ?? null, e.publisher ?? null, e.isbns ?? [], e.series ?? null, e.seriesIndex ?? null,
      e.cover ? `derived/${n}/cover-240.webp` : null, `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, copy])).id;
    const metadata = f.library === false ? {} : { calibre: { libraryId: "5f4c1a2b-0000-4000-8000-00000000000a", bookId: n, tags: ["Surrealism"] } };
    await q(`insert into ebook_files(ebook_id, sha256, s3_key, format, size_bytes, content_type, status, metadata, cover_key)
      values ($1, $2, $3, 'epub', 1000, 'application/epub+zip', 'stored', $4::jsonb, $5)`, [ebook, String(n).padStart(64, "a"),
      `ebooks/${n}.epub`, JSON.stringify(metadata), e.cover ? `derived/${n}/cover-240.webp` : null]);
    return { work, edition, copy, ebook };
  }
  const item = (d: Difference) => ({ ebookId: d.ebookId, field: d.field, durtal: d.durtal, file: d.file });
  async function differences(ebookId: string) {
    const [sides] = await readDifferenceSides(ebookId);
    return sides ? differencesOf(sides) : [];
  }
  const find = async (ebookId: string, field: DifferenceField) => (await differences(ebookId)).find((d) => d.field === field);
  // The catalogue's writers journal after they return (recordActivity), so a read waits for those writes
  const events = async () => {
    await activitySettled();
    return (await q(`select event_key, metadata from activity_events order by created_at, id`)).map((r) => r.event_key as string);
  };

  it("lists each field that differs after normalisation, for the library's linked e-books only", async () => {
    const nadja = await linked({
      title: "Nadja", author: "André Breton", year: 1964, publisher: "Gallimard",
      ebook: { title: "NADJA", authors: ["Breton, Andre"], language: "eng", year: 2012, publisher: "Grove Press", isbns: ["9780802150264"],
        series: "Surrealist Classics", seriesIndex: 2, cover: true },
    });
    const wanted = await linked({ title: "Le Paysan de Paris", author: "Louis Aragon", status: "wanted", ebook: { authors: ["Paul Éluard"], publisher: "Gallimard" } });
    // An upload, not from the library: never listed
    await linked({ title: "Les Champs magnétiques", author: "Philippe Soupault", library: false, ebook: { year: 1920 } });
    const before = await one(`select count(*)::int as n, max(updated_at) as at from ebooks`);

    const page = await getDifferences({ shown: 50 });
    expect(page.counts).toEqual({ language: 1, year: 1, publisher: 2, isbn: 1, cover: 1, series: 1, authors: 1, status: 1 });
    expect(page.total).toBe(9);
    // The first field with differences, in the section's order
    expect(page.field).toBe("authors");
    expect(page.rows.map((d) => [d.bookTitle, d.durtal, d.file, d.keep, d.use, d.why])).toEqual([
      ["Le Paysan de Paris", "Louis Aragon", "Paul Éluard", true, false, "Authors are changed on the book's page."],
    ]);
    expect((await differences(nadja.ebook)).map((d) => [d.field, d.durtal, d.file])).toEqual([
      ["series", null, "Surrealist Classics"],
      ["language", "fr", "en"],
      ["year", "1964", "2012"],
      ["publisher", "Gallimard", "Grove Press"],
      ["isbn", null, "9780802150264"],
      ["cover", null, "The e-book's cover"],
    ]);
    expect(await find(wanted.ebook, "status")).toMatchObject({ durtal: "Wanted", file: "The e-book is here", keep: false, use: false });
    // Reading them wrote nothing
    expect(await one(`select count(*)::int as n, max(updated_at) as at from ebooks`)).toEqual(before);
    expect(await events()).toEqual([]);
  });

  it("keeps Durtal's on the e-book, and undoes it once, while the e-book still has it", async () => {
    const { ebook, work } = await linked({ title: "Nadja", author: "André Breton", publisher: "Gallimard", ebook: { language: "en", publisher: "Grove Press" } });
    const language = (await find(ebook, "language"))!;
    const { done, refused } = await decideDifferences("keep", [item(language)]);
    expect(refused).toEqual([]);
    expect(done).toMatchObject([{ ebookId: ebook, field: "language", bookTitle: "Nadja", message: "Kept Durtal's language for the e-book." }]);
    expect((await one(`select language from ebooks where id = $1`, [ebook])).language).toBe("fr");
    expect(await find(ebook, "language")).toBeUndefined();
    const event = await one(`select entity_id, metadata from activity_events where event_key = $1`, [DIFFERENCE_EVENTS.kept]);
    expect(event.entity_id).toBe(work);
    expect(event.metadata).toMatchObject({ targetName: "Language", oldValue: "English", newValue: "French", extra: { field: "language", before: "en", after: "fr" } });

    // The same choice again: the row is gone, so it is refused and writes nothing
    expect((await decideDifferences("keep", [item(language)])).refused).toEqual([{ ebookId: ebook, field: "language", message: "This difference changed. Reload to see it." }]);

    expect(await undoDifferences([done[0].eventId])).toEqual({ done: [{ eventId: done[0].eventId, message: "The e-book's language is back." }], refused: [] });
    expect((await one(`select language from ebooks where id = $1`, [ebook])).language).toBe("en");
    expect(await find(ebook, "language")).toMatchObject({ durtal: "fr", file: "en" });
    expect((await undoDifferences([done[0].eventId])).refused).toEqual([{ eventId: done[0].eventId, message: "This choice is already undone." }]);

    // Keep the publisher, then change the e-book's by hand: its undo is refused
    const kept = (await decideDifferences("keep", [item((await find(ebook, "publisher"))!)])).done[0];
    expect((await one(`select publisher, search_text from ebooks where id = $1`, [ebook]))).toMatchObject({ publisher: "Gallimard", search_text: "nadja andre breton" });
    await q(`update ebooks set publisher = 'Other' where id = $1`, [ebook]);
    expect((await undoDifferences([kept.eventId])).refused).toEqual([{ eventId: kept.eventId, message: "The value changed since this choice, so it is not undone." }]);
    expect((await one(`select publisher from ebooks where id = $1`, [ebook])).publisher).toBe("Other");
    // The refused undo leaves no claim: it can be tried again once the value is back
    await q(`update ebooks set publisher = 'Gallimard' where id = $1`, [ebook]);
    expect((await undoDifferences([kept.eventId])).done).toHaveLength(1);
    expect(await events()).toEqual([DIFFERENCE_EVENTS.kept, DIFFERENCE_EVENTS.undone, DIFFERENCE_EVENTS.kept, DIFFERENCE_EVENTS.undone]);
  });

  it("uses the file's through the catalogue's writers, per row and in bulk, and undoes them", async () => {
    const a = await linked({ title: "Nadja", author: "André Breton", year: 1964, ebook: { year: 2012, series: "Surrealist Classics", seriesIndex: 2 } });
    const b = await linked({ title: "Arcane 17", author: "André Breton", year: 1947, ebook: { year: 2004, isbns: ["9780802150264"] } });
    const page = await getDifferences({ field: "year", shown: 50 });
    expect(page.rows.map((d) => d.bookTitle)).toEqual(["Arcane 17", "Nadja"]);

    // Bulk: both years, each written by the edition writer and journalled
    const run = await decideDifferences("use", page.rows.map(item));
    expect(run.refused).toEqual([]);
    expect(run.done.map((d) => d.message)).toEqual(["The book takes the file's year.", "The book takes the file's year."]);
    expect((await q(`select publication_year from editions order by publication_year`)).map((r) => r.publication_year)).toEqual([2004, 2012]);
    expect((await getDifferences({ field: "year", shown: 50 })).counts.year).toBeUndefined();
    await activitySettled();
    expect((await q(`select event_key from activity_events where entity_id = $1 order by created_at`, [a.work])).map((r) => r.event_key))
      .toEqual(expect.arrayContaining(["work.edition_updated", DIFFERENCE_EVENTS.used]));

    // An ISBN and a cover
    const isbn = await decideDifferences("use", [item((await find(b.ebook, "isbn"))!)]);
    expect((await one(`select isbn_13 from editions where id = $1`, [b.edition])).isbn_13).toBe("9780802150264");
    await q(`update ebooks set cover_key = 'derived/x/cover-240.webp' where id = $1`, [a.ebook]);
    await q(`update ebook_files set cover_key = 'derived/x/cover-240.webp' where ebook_id = $1`, [a.ebook]);
    const cover = await decideDifferences("use", [item((await find(a.ebook, "cover"))!)]);
    expect(cover.done[0].message).toBe("The edition takes the e-book's cover.");
    expect((await one(`select cover_s3_key from editions where id = $1`, [a.edition])).cover_s3_key).toBe(`gold/covers/${a.edition}/stage.webp`);
    expect(await find(a.ebook, "cover")).toBeUndefined();

    // A series by name (found or made by the work writer), then its number, which only then differs
    expect(await find(a.ebook, "seriesIndex")).toBeUndefined();
    const series = await decideDifferences("use", [item((await find(a.ebook, "series"))!)]);
    expect((await one(`select s.title from works w join series s on s.id = w.series_id where w.id = $1`, [a.work])).title).toBe("Surrealist Classics");
    const number = await decideDifferences("use", [item((await find(a.ebook, "seriesIndex"))!)]);
    expect((await one(`select series_position from works where id = $1`, [a.work])).series_position).toBe("2");

    // Undo all, newest first; each value comes back
    const undone = await undoDifferences([number, series, cover, isbn, run].flatMap((r) => r.done.map((d) => d.eventId)));
    expect(undone.refused).toEqual([]);
    expect(await one(`select series_id, series_position from works where id = $1`, [a.work])).toEqual({ series_id: null, series_position: null });
    expect((await q(`select publication_year, isbn_13, cover_s3_key from editions order by publication_year`)).map((r) => ({ ...r })))
      .toEqual([{ publication_year: 1947, isbn_13: null, cover_s3_key: null }, { publication_year: 1964, isbn_13: null, cover_s3_key: null }]);
    // Every difference is back, with the cover the e-book was given above
    expect((await getDifferences({ shown: 50 })).counts).toEqual({ ...page.counts, cover: 1 });
  });

  it("refuses what is not offered or no longer shown, and never writes for it", async () => {
    const { ebook } = await linked({ title: "Le Paysan de Paris", author: "Louis Aragon", status: "on_order", publisher: "Gallimard",
      ebook: { authors: ["Paul Éluard"], publisher: "Folio", isbns: ["9780802150264", "9782070367306"] } });
    await q(`update editions set metadata_locked = true`);
    const all = await differences(ebook);
    expect(all.map((d) => [d.field, d.use, d.why])).toEqual([
      ["authors", false, "Authors are changed on the book's page."],
      ["publisher", false, "The edition's details are locked."],
      ["isbn", false, "The file has more than one ISBN."],
      ["status", false, null],
    ]);
    const { done, refused } = await decideDifferences("use", all.map(item));
    expect(done).toEqual([]);
    expect(refused.map((r) => r.message)).toEqual([
      "Authors are changed on the book's page.",
      "The edition's details are locked.",
      "The file has more than one ISBN.",
      "Use the file's is not offered here.",
    ]);
    // Values other than those shown: refused
    const publisher = all.find((d) => d.field === "publisher")!;
    expect((await decideDifferences("keep", [{ ...item(publisher), durtal: "Seuil" }])).refused[0].message).toBe("This difference changed. Reload to see it.");
    expect((await decideDifferences("keep", [item(all.find((d) => d.field === "status")!)])).refused[0].message).toBe("Keep Durtal's is not offered here.");
    expect(await events()).toEqual([]);
    expect((await one(`select publisher from ebooks where id = $1`, [ebook])).publisher).toBe("Folio");
  });

  it("names the edition that already holds a file's ISBN, and writes ISBN in capitals", async () => {
    await linked({ title: "Arcane 17", author: "André Breton", isbn13: "9780802150264", ebook: {} });
    const { ebook, edition } = await linked({ title: "Nadja", author: "André Breton", ebook: { isbns: ["9780802150264"] } });
    const isbn = (await find(ebook, "isbn"))!;
    expect((await decideDifferences("use", [item(isbn)])).refused).toEqual([
      { ebookId: ebook, field: "isbn", message: 'An edition with ISBN 9780802150264 already exists ("Arcane 17")' },
    ]);
    expect((await one(`select isbn_13 from editions where id = $1`, [edition])).isbn_13).toBeNull();
    const kept = await decideDifferences("keep", [item(isbn)]);
    expect(kept.done.map((d) => d.message)).toEqual(["Kept Durtal's ISBN for the e-book."]);
    expect((await undoDifferences(kept.done.map((d) => d.eventId))).done.map((d) => d.message)).toEqual(["The e-book's ISBN is back."]);
  });
});
