import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_LIBRARY_STATISTICS_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln742_library_statistics");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln742_library_statistics")
    throw new Error("Library statistics tests require a disposable local sln742_library_statistics database");
}
const client = url ? postgres(url, { prepare: false, max: 6, onnotice: () => {} }) : null;
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
import { breakdown, busiestYears, copyStats, extremes, favouriteCovers, libraryNumbers, rankings, ratingSpread, writtenYears } from "@/lib/statistics/library";

/*
 * Library statistics against PostgreSQL (SLN-742): only owned books count (a
 * copy that is not deaccessioned), copies count the same way, and films,
 * wanted books and deaccessioned copies stay out.
 */

describe.skipIf(!url)("library statistics with PostgreSQL", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async (text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as string;
  let serial = 0;
  const work = (title: string, o: { year?: number | null; language?: string; rating?: number | null; kind?: string } = {}) =>
    value(`insert into works(title, slug, kind, original_year, original_language, rating) values ($1, $2, $3, $4, $5, $6) returning id`, [
      title,
      `work-${++serial}`,
      o.kind ?? "book",
      o.year ?? null,
      o.kind && o.kind !== "book" ? null : (o.language ?? "fr"),
      o.rating ?? null,
    ]);
  const edition = (workId: string, o: { pages?: number | null; language?: string; cover?: string | null } = {}) =>
    value(`insert into editions(work_id, title, language, page_count, thumbnail_s3_key) values ($1, 'E', $2, $3, $4) returning id`, [
      workId,
      o.language ?? "fr",
      o.pages === undefined ? 200 : o.pages,
      o.cover ?? null,
    ]);
  const copy = (editionId: string, o: { at?: string; status?: string; format?: string | null; acquired?: string | null } = {}) =>
    value(`insert into instances(edition_id, location_id, status, format, acquisition_date) values ($1, $2, $3, $4, $5::date) returning id`, [
      editionId,
      o.at ?? amsterdam,
      o.status ?? "available",
      o.format === undefined ? "paperback" : o.format,
      o.acquired ?? null,
    ]);
  const writer = async (workId: string, authorId: string) =>
    q(`insert into work_authors(work_id, author_id, role, sort_order) values ($1, $2, 'author', 0)`, [workId, authorId]);

  let amsterdam = "";
  let huysmans = "";
  let bloy = "";
  let againstNature = "";
  let houseOfPleasures = "";

  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln742_library_statistics", { emptyLocations: true });
    amsterdam = await value(`insert into locations(name, type) values ('Amsterdam', 'physical') returning id`);
    const kindle = await value(`insert into locations(name, type) values ('Kindle', 'digital') returning id`);
    const mexico = await value(`insert into locations(name, type) values ('Mexico City', 'physical') returning id`);
    const france = await value(`insert into countries(name, alpha_2, alpha_3) values ('France', 'FR', 'FRA') returning id`);
    const belgium = await value(`insert into countries(name, alpha_2, alpha_3) values ('Belgium', 'BE', 'BEL') returning id`);
    huysmans = await value(`insert into authors(name, slug, nationality_id) values ('Joris-Karl Huysmans', 'huysmans', $1) returning id`, [france]);
    bloy = await value(`insert into authors(name, slug, nationality_id) values ('Léon Bloy', 'bloy', $1) returning id`, [france]);
    const rodenbach = await value(`insert into authors(name, slug, nationality_id) values ('Georges Rodenbach', 'rodenbach', $1) returning id`, [belgium]);
    const translator = await value(`insert into authors(name, slug) values ('Translator', 'translator') returning id`);
    const decadent = await value(`insert into book_categories(name, slug, level) values ('Decadent', 'decadent', 1) returning id`);
    const gallimard = await value(`insert into publishing_houses(name, slug) values ('Gallimard', 'gallimard') returning id`);

    // Two copies of one edition, and an English edition on a Kindle: one book, two editions, three copies
    againstNature = await work("Against Nature", { year: 1884, rating: 5 });
    const french = await edition(againstNature, { pages: 300, cover: "covers/a.jpg" });
    const english = await edition(againstNature, { pages: 250, language: "en" });
    await copy(french, { acquired: "2019-05-01" });
    await copy(french, { format: "hardcover", acquired: "2019-06-01" });
    await copy(english, { at: kindle, format: "epub" });
    await writer(againstNature, huysmans);
    await q(`insert into work_categories(work_id, category_id) values ($1, $2)`, [againstNature, decadent]);
    await q(`insert into edition_publishers(edition_id, publisher_id) values ($1, $2)`, [french, gallimard]);
    await q(`insert into readings(work_id, status, started_precision, finished_on, finished_precision) values ($1, 'finished', 'unknown', '2020-01-01', 'day')`, [againstNature]);

    const enRoute = await work("En Route", { year: 1884, rating: 3.5 });
    await copy(await edition(enRoute, { pages: 450, cover: "covers/b.jpg" }), { at: mexico, format: null, acquired: "2021-01-01" });
    await writer(enRoute, huysmans);

    const bruges = await work("Bruges-la-Morte", { year: 1892 });
    const brugesEdition = await edition(bruges, { pages: 120 });
    await copy(brugesEdition);
    await writer(bruges, rodenbach);
    await q(`insert into edition_contributors(edition_id, author_id, role, sort_order) values ($1, $2, 'translator', 0)`, [brugesEdition, translator]);

    // Not owned: wanted with no copy, only a deaccessioned copy, and a film
    houseOfPleasures = await work("The Woman Who Was Poor", { year: 1897, rating: 4 });
    await writer(houseOfPleasures, bloy);
    const gone = await work("Gone", { year: 1700 });
    await copy(await edition(gone, { pages: 900 }), { status: "deaccessioned" });
    await writer(gone, bloy);
    await work("A Film", { year: 1957, kind: "film" });
  }, 60000);

  afterAll(async () => {
    await client?.end();
  });

  it("counts the owned books, their editions and their held copies", async () => {
    expect(await libraryNumbers()).toEqual({
      books: 3,
      editions: 4,
      copies: 5,
      pages: 300 + 250 + 450 + 120,
      authors: 2,
      publishers: 1,
      languages: 1,
      countries: 2,
    });
  });

  it("puts the owned books in the years they were written", async () => {
    const written = await writtenYears();
    expect(written).toEqual({
      years: [
        { year: 1884, count: 2 },
        { year: 1892, count: 1 },
      ],
      undated: 0,
    });
    const busiest = await busiestYears(written.years);
    expect(busiest).toHaveLength(1);
    expect(busiest[0]).toMatchObject({ year: 1884, books: 2 });
    // Best rated first, with the card's cover and the first writer
    expect(busiest[0].covers.map((c) => [c.title, c.author, c.cover])).toEqual([
      ["Against Nature", "Joris-Karl Huysmans", "covers/a.jpg"],
      ["En Route", "Joris-Karl Huysmans", "covers/b.jpg"],
    ]);
  });

  it("ranks languages, countries, categories, authors and houses by owned books", async () => {
    const ranks = await rankings();
    expect(ranks.languages).toEqual([{ key: "fr", name: "fr", count: 3 }]);
    expect(ranks.countries).toEqual([
      { key: "FR", name: "France", count: 2 },
      { key: "BE", name: "Belgium", count: 1 },
    ]);
    expect(ranks.categories.map((c) => [c.name, c.count])).toEqual([["Decadent", 1]]);
    // Translators are not writers; Bloy owns nothing here
    expect(ranks.authors.map((a) => [a.name, a.slug, a.count])).toEqual([
      ["Joris-Karl Huysmans", "huysmans", 2],
      ["Georges Rodenbach", "rodenbach", 1],
    ]);
    expect(ranks.publishers.map((p) => [p.name, p.slug, p.count])).toEqual([["Gallimard", "gallimard", 1]]);
  });

  it("splits read, rated, translated and digital", async () => {
    expect(await breakdown()).toEqual({
      read: 1,
      unread: 2,
      rated: 2,
      unrated: 1,
      translated: 1,
      original: 3,
      print: 4,
      digital: 1,
    });
    const spread = await ratingSpread();
    expect(spread).toHaveLength(10);
    expect(spread.filter((r) => r.count)).toEqual([
      { rating: 3.5, count: 1 },
      { rating: 5, count: 1 },
    ]);
  });

  it("counts copies by format, place and the year they came", async () => {
    const copies = await copyStats();
    expect(copies.formats).toEqual([
      { format: "paperback", count: 2 },
      { format: "epub", count: 1 },
      { format: "hardcover", count: 1 },
      { format: null, count: 1 },
    ]);
    expect(copies.places.map((p) => [p.name, p.count])).toEqual([
      ["Amsterdam", 3],
      ["Kindle", 1],
      ["Mexico City", 1],
    ]);
    expect(copies.acquired).toEqual([
      { year: 2019, count: 2 },
      { year: 2021, count: 1 },
    ]);
    expect(copies.undated).toBe(2);
  });

  it("finds the oldest, newest, longest and shortest owned books", async () => {
    const ends = await extremes();
    expect(ends.oldest).toMatchObject({ title: "Against Nature", value: 1884, author: "Joris-Karl Huysmans" });
    expect(ends.newest).toMatchObject({ title: "Bruges-la-Morte", value: 1892 });
    expect(ends.longest).toMatchObject({ title: "En Route", value: 450, cover: "covers/b.jpg" });
    expect(ends.shortest).toMatchObject({ title: "Bruges-la-Morte", value: 120, cover: null });
    expect((await favouriteCovers()).map((c) => c.title)).toEqual(["Against Nature", "En Route"]);
  });

  // Last: it adds a book
  it("shows a year's covered books before its blank ones, best rated first among each", async () => {
    const blank = await work("A Rebours", { year: 1884, rating: 5 });
    await copy(await edition(blank));
    const [year] = await busiestYears((await writtenYears()).years, 1);
    expect(year.covers.map((c) => [c.title, c.cover])).toEqual([
      ["Against Nature", "covers/a.jpg"],
      ["En Route", "covers/b.jpg"],
      ["A Rebours", null],
    ]);
  });
});
