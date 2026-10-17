import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_HUB_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln448_reading_hub");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln448_reading_hub")
    throw new Error("Reading hub tests require a disposable local sln448_reading_hub database");
}
const client = url ? postgres(url, { prepare: false, max: 4, onnotice: () => {} }) : null;
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
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { getJournalFacets, getRecentlyFinished, journalReadingIds, queryJournal } from "@/lib/reading/journal";
import { parseJournalQuery } from "@/lib/reading/journal-params";
import { getReadingHubOpen, getOpenReadings, searchBooksToRead } from "@/lib/actions/reading";

// The reading hub's queries (SLN-448): the journal, the read's rating, re-reads and the book picker.

describe.skipIf(!url)("the reading hub with PostgreSQL", () => {
  const db = testDb!;
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln448_reading_hub");
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln448_reading_hub", { emptyLocations: true });
  }, 30000);

  let serial = 0;
  const book = async (title: string, { rating = null as number | null, author = null as string | null } = {}) => {
    const id = await value(`insert into works(title, slug, rating) values ($1, $2, $3) returning id`, [title, `book-${++serial}`, rating]);
    if (author) {
      const a = await value(`insert into authors(name, slug) values ($1, $2) returning id`, [author, `author-${serial}`]);
      await q(`insert into work_authors(work_id, author_id, role) values ($1, $2, 'author')`, [id, a]);
    }
    return id;
  };
  interface Read {
    status?: string;
    started?: [string, string] | null;
    finished?: [string, string] | null;
    rating?: number | null;
    format?: string;
    sourceKey?: string | null;
  }
  const read = (workId: string, r: Read = {}) =>
    value(
      `insert into readings(work_id, status, started_on, started_precision, finished_on, finished_precision, rating, format, source_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        workId,
        r.status ?? "finished",
        r.started?.[0] ?? null,
        r.started?.[1] ?? "unknown",
        r.finished?.[0] ?? null,
        r.finished?.[1] ?? "unknown",
        r.rating ?? null,
        r.format ?? "print",
        r.sourceKey ?? null,
      ],
    );
  const journal = (params: Record<string, string> = {}) => queryJournal(parseJournalQuery(params));
  const ids = async (params: Record<string, string> = {}) => (await journal(params)).rows.map((r) => r.id);

  it("rates each read by its own rating, falling back to the book's only for the book's only finished read", async () => {
    // A book rated 5 whose 2012 read was rated 3
    const proust = await book("Swann's Way", { rating: 5 });
    const read2012 = await read(proust, { finished: ["2012-06-01", "month"], rating: 3 });
    const read2020 = await read(proust, { finished: ["2020-01-01", "year"], rating: 5 });
    // A lone finished read with no rating uses the book's
    const watt = await book("Watt", { rating: 4.5 });
    const lone = await read(watt, { finished: ["2018-03-04", "day"] });
    // Two finished reads, one unrated: no fallback for it
    const molloy = await book("Molloy", { rating: 4 });
    const unrated = await read(molloy, { finished: ["2010-01-01", "year"] });
    const rated = await read(molloy, { finished: ["2015-01-01", "year"], rating: 2 });

    const rows = new Map((await journal()).rows.map((r) => [r.id, r.rating]));
    expect(rows.get(read2012)).toBe(3);
    expect(rows.get(read2020)).toBe(5);
    expect(rows.get(lone)).toBe(4.5);
    expect(rows.get(unrated)).toBeNull();
    expect(rows.get(rated)).toBe(2);

    expect(await ids({ minRating: "4" })).toEqual([read2020, lone]);
    // The Rating sort uses the read's rating; unrated last either way
    expect(await ids({ sort: "rating" })).toEqual([read2020, lone, read2012, rated, unrated]);
    expect(await ids({ sort: "rating", order: "asc" })).toEqual([rated, read2012, lone, read2020, unrated]);
    // The recently finished reads carry the read's rating too
    const recent = await getRecentlyFinished(6);
    expect(recent.map((r) => [r.id, r.rating])).toEqual([
      [read2020, 5],
      [lone, 4.5],
      [rated, 2],
      [read2012, 3],
      [unrated, null],
    ]);
  });

  it("marks re-reads in the order the book numbers its readings; an abandoned first attempt does not count", async () => {
    const a = await book("Ulysses");
    const first = await read(a, { finished: ["2001-01-01", "year"] });
    const second = await read(a, { started: ["2010-02-01", "month"], finished: ["2010-05-01", "month"] });
    const open = await read(a, { status: "reading", started: ["2026-09-01", "day"] });
    const b = await book("The Waves");
    const gaveUp = await read(b, { status: "abandoned", started: ["2015-01-01", "year"], finished: ["2015-01-01", "year"] });
    const after = await read(b, { finished: ["2019-01-01", "year"] });
    // Unknown dates come first, then the source key breaks the tie
    const c = await book("Nadja");
    const unknownA = await read(c, { sourceKey: "a" });
    const unknownB = await read(c, { sourceKey: "b" });

    const rereads = new Map((await journal()).rows.map((r) => [r.id, r.reread]));
    expect(rereads.get(first)).toBe(false);
    expect(rereads.get(second)).toBe(true);
    expect(rereads.get(open)).toBe(true);
    expect(rereads.get(gaveUp)).toBe(false);
    expect(rereads.get(after)).toBe(false);
    expect(rereads.get(unknownA)).toBe(false);
    expect(rereads.get(unknownB)).toBe(true);
    expect((await ids({ rereads: "1" })).sort()).toEqual([second, open, unknownB].sort());
    const { summary } = await journal();
    expect(summary).toEqual({ readings: 7, finished: 5, abandoned: 1, rereads: 3 });
  });

  it("groups by the year of finish or stop at any precision, in progress first, unknown dates last, and filters and sorts", async () => {
    const w = await book("Austerlitz", { author: "W. G. Sebald" });
    const x = await book("Éloge de l'ombre", { author: "Jun'ichirō Tanizaki" });
    const y = await book("Watt", { author: "Samuel Beckett" });
    const reading = await read(w, { status: "reading", started: ["2026-09-01", "day"] });
    const paused = await read(x, { status: "paused", started: ["2026-01-01", "month"] });
    const day2024 = await read(y, { started: ["2024-03-01", "day"], finished: ["2024-03-20", "day"], format: "audio" });
    const month2024 = await read(x, { finished: ["2024-11-01", "month"], rating: 4 });
    const year2019 = await read(w, { finished: ["2019-01-01", "year"], format: "ebook" });
    const stopped2021 = await read(y, { status: "abandoned", started: ["2021-02-01", "month"], finished: ["2021-02-01", "month"] });
    const unknown = await read(x, {});

    // Finished, newest first: in progress, 2024 (month after day by date), 2021, 2019, then unknown
    const rows = (await journal()).rows;
    expect(rows.map((r) => r.id)).toEqual([reading, paused, month2024, day2024, stopped2021, year2019, unknown]);
    // Oldest first: the years, then in progress, then unknown
    expect(await ids({ order: "asc" })).toEqual([year2019, stopped2021, day2024, month2024, reading, paused, unknown]);
    // Year range on the finish or stop date
    expect(await ids({ yearMin: "2021", yearMax: "2024" })).toEqual([month2024, day2024, stopped2021]);
    expect(await ids({ yearMin: "2024" })).toEqual([month2024, day2024]);
    // Status, format, text without accents on title and author
    expect(await ids({ status: "reading,paused" })).toEqual([reading, paused]);
    expect(await ids({ status: "abandoned" })).toEqual([stopped2021]);
    expect(await ids({ format: "audio,ebook" })).toEqual([day2024, year2019]);
    expect(await ids({ q: "eloge" })).toEqual([paused, month2024, unknown]);
    expect(await ids({ q: "tanizaki" })).toEqual([paused, month2024, unknown]);
    expect(await ids({ q: "beckett watt" })).toEqual([day2024, stopped2021]);
    // Started: newest first, unknown starts last; Title: A to Z, ties by id
    expect(await ids({ sort: "started" })).toEqual([reading, paused, day2024, stopped2021, ...[month2024, year2019, unknown].sort()]);
    const byTitle = (await journal({ sort: "title" })).rows;
    expect(byTitle.slice(0, 2).map((r) => r.id)).toEqual([reading, year2019].sort());
    // One book's readings stay together, by id
    const titles = byTitle.map((r) => r.title);
    expect(titles.filter((t, i) => t !== titles[i - 1])).toHaveLength(3);
    // Paging
    const page2 = await journal({ perPage: "24", page: "2" });
    expect(page2.rows).toEqual([]);
    expect(page2.summary.readings).toBe(7);
    // The facets come from every reading
    expect(await getJournalFacets()).toEqual({ yearRange: { min: 2019, max: 2024 }, formats: ["audio", "ebook", "print"] });
    // Each row carries its reading's fingerprint, the one the open readings show
    const open = await getOpenReadings();
    const fp = new Map(rows.map((r) => [r.id, r.fingerprint]));
    expect(open.map((o) => o.fingerprint)).toEqual([fp.get(reading), fp.get(paused)]);
  });

  it.each(["tracked", "wanted", "on_order"])("does not call a %s book owned just because it has an active copy", async (status) => {
    const workId = await book(`Still ${status}`);
    await q(`update works set catalogue_status = $1 where id = $2`, [status, workId]);
    const location = await value(`insert into locations(name, type) values ('Study', 'physical') returning id`);
    const edition = await value(`insert into editions(work_id, title) values ($1, 'E') returning id`, [workId]);
    await q(`insert into instances(edition_id, location_id, status) values ($1, $2, 'available')`, [edition, location]);
    expect(await searchBooksToRead("")).toMatchObject([{ id: workId, owned: false, catalogueStatus: status }]);
  });

  it("finds books for the picker without accents, owned first; a book whose only copy is deaccessioned is not owned", async () => {
    const home = await value(`insert into locations(name, type) values ('Amsterdam', 'physical') returning id`);
    const copy = async (workId: string, status: string) => {
      const e = await value(`insert into editions(work_id, title, language) values ($1, 'E', 'fr') returning id`, [workId]);
      await q(`insert into instances(edition_id, location_id, status) values ($1, $2, $3)`, [e, home, status]);
    };
    const gone = await book("Árbol de Diana", { author: "Alejandra Pizarnik" });
    await copy(gone, "deaccessioned");
    const owned = await book("Zona sagrada", { author: "Carlos Fuentes" });
    await copy(owned, "lent_out");
    await q(`update works set catalogue_status = 'accessioned' where id in ($1, $2)`, [gone, owned]);
    const wanted = await book("Arbol de la ciencia", { author: "Pío Baroja" });
    await q(`update works set catalogue_status = 'wanted' where id = $1`, [wanted]);
    await copy(wanted, "available");
    const reading = await read(owned, { status: "reading", started: ["2026-09-01", "day"] });
    await q(`update readings set current_percent = 44.2 where id = $1`, [reading]);
    await read(wanted, { finished: ["2001-01-01", "year"] });
    await read(wanted, { finished: ["2011-01-01", "year"] });

    const all = await searchBooksToRead("");
    // Titles in order without their accents: "arbol de diana" before "arbol de la ciencia"
    expect(all.map((b) => [b.title, b.owned])).toEqual([
      ["Zona sagrada", true],
      ["Árbol de Diana", false],
      ["Arbol de la ciencia", false],
    ]);
    const arbol = await searchBooksToRead("arbol");
    expect(arbol.map((b) => b.title)).toEqual(["Árbol de Diana", "Arbol de la ciencia"]);
    expect((await searchBooksToRead("pizarnik")).map((b) => b.title)).toEqual(["Árbol de Diana"]);
    const zona = all[0];
    expect(zona).toMatchObject({ state: "reading", percent: 44.2, openReadingId: reading, catalogueStatus: expect.any(String) });
    expect(zona.openFingerprint).toBe((await getOpenReadings())[0].fingerprint);
    expect(all[2]).toMatchObject({ state: "read", reads: 2, catalogueStatus: "wanted", openReadingId: null });
  });
  it("bounds both hub sections without truncating their counts or global consumers", async () => {
    for (let i=0;i<20;i++) await read(await book(`Bounded open ${i}`),{status:i<10?"reading":"paused"});
    const result = await getReadingHubOpen("2026-10-17");
    expect(result.counts).toEqual({reading:10,paused:10});
    expect(result.reading).toHaveLength(8);
    expect(result.paused).toHaveLength(8);
    expect(await getOpenReadings()).toHaveLength(20);
    expect(result.reading[0].reading.updatedAt).toBeInstanceOf(Date);
    expect(Object.keys(result.estimates).every(id=>result.reading.some(row=>row.reading.id===id))).toBe(true);
  });

  it("keeps exact-work journal rows, counts and export scope together", async () => {
    const one = await book("Exact one"), two = await book("Exact two");
    const wanted = await read(one,{status:"paused"});
    await read(two,{status:"paused"});
    const query = parseJournalQuery({work:one,status:"paused"});
    const result = await queryJournal(query);
    expect(result.rows.map(row=>row.id)).toEqual([wanted]);
    expect(result.summary.readings).toBe(1);
    expect(await journalReadingIds(query)).toEqual([wanted]);
    const invalid = parseJournalQuery({work:"broken"});
    expect((await queryJournal(invalid)).summary.readings).toBe(0);
    expect(await journalReadingIds(invalid)).toEqual([]);
  });


  it("returns a coherent paged journal with global ordinals, full fingerprints and unchanged export scope", async () => {
    const work = await book("Paged history", { rating: 5, author: "History Writer" });
    await read(work, { status: "abandoned", sourceKey: "aggregate-test:a" });
    await read(work, { sourceKey: "aggregate-test:b" });
    await read(work, { finished: ["2019-01-01", "year"] });
    const current: string[] = [];
    for (let day = 1; day <= 25; day++) current.push(await read(work, {
      finished: [`2025-01-${String(day).padStart(2, "0")}`, "day"], rating: day % 2 ? 4 : null,
    }));
    await read(work, { status: "paused", started: ["2026-01-01", "day"] });
    await q(`update readings set review_html = '<p>Full selected row.</p>', current_chapter = 'Chapter XVII' where id = $1`, [current[0]]);
    const solo = await book("Sole fallback", { rating: 4.5 });
    const soloRead = await read(solo, { finished: ["2025-06-01", "day"] });
    const params = { work, status: "finished", yearMin: "2025", yearMax: "2025", perPage: "24", sort: "finished", order: "asc", q: "History Writer" };

    const execute = vi.spyOn(db, "execute");
    const first = await (async () => {
      try {
        const result = await journal(params);
        expect(execute).toHaveBeenCalledTimes(1);
        return result;
      } finally { execute.mockRestore(); }
    })();
    expect(first.summary).toEqual({ readings: 25, finished: 25, abandoned: 0, rereads: 25 });
    expect(first.rows.map((r) => r.id)).toEqual(current.slice(0, 24));
    expect(first.rows.map((r) => r.ordinal)).toEqual(Array.from({ length: 24 }, (_, i) => i + 4));
    expect(first.rows.every((r) => r.reread)).toBe(true);
    expect(first.rows.map((r) => r.rating)).toEqual(Array.from({ length: 24 }, (_, i) => i % 2 ? null : 4));
    expect(first.rows[0].fingerprint).toBe(await value(`select md5(to_jsonb(r)::text) from readings r where id = $1`, [current[0]]));
    expect(first.rows[0]).not.toHaveProperty("review_html");
    expect(first.rows[0]).not.toHaveProperty("page_order");
    const second = await journal({ ...params, page: "2" });
    expect(second.rows.map((r) => r.id)).toEqual(current.slice(24));
    expect(second.rows[0].ordinal).toBe(28);
    expect(second.summary).toEqual(first.summary);
    expect((await journal({ ...params, page: "3" })).rows).toEqual([]);
    const beyond = await journal({ ...params, page: "999" });
    expect(beyond.rows).toEqual([]); expect(beyond.summary).toEqual(first.summary);
    expect(await journalReadingIds(parseJournalQuery({ ...params, page: "2" }))).toEqual(current);
    expect((await journal({ yearMin: "2025", minRating: "4.5" })).rows.map((r) => r.id)).toEqual([soloRead]);
    for (const filters of [{ ...params, q: "no matching reading" }, { work: "invalid" }]) {
      const empty = await journal(filters);
      expect(empty).toEqual({ rows: [], summary: { readings: 0, finished: 0, abandoned: 0, rereads: 0 } });
      expect(await journalReadingIds(parseJournalQuery(filters))).toEqual([]);
    }
  });

});
