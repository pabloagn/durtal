import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_LIBRARY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln449_reading_library")
    throw new Error("Reading library tests require a disposable local sln449_reading_library database");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
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
import { getWorks, getWorkCount, type WorkFilters } from "@/lib/actions/works";
import { getReadingSummaries, getSeriesNextToRead } from "@/lib/actions/reading";
import { getAuthorBySlug } from "@/lib/actions/authors";
import { getSeriesDetail } from "@/lib/actions/series";
import { getWorksForTimeline } from "@/lib/actions/work-timeline";
import { parseReadingFilters, LIBRARY_SORTS } from "@/lib/reading/filter-params";
import { readingRecordOf } from "@/lib/reading/record";
import { GET as listWorks } from "@/app/api/works/route";

// Reading across the library (SLN-449): filters, sorts, extras, summaries,
// the author, series and API, with PostgreSQL.

describe.skipIf(!url)("reading across the library with PostgreSQL", () => {
  const db = testDb!;
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  let serial = 0;
  let home = "";
  let digital = "";
  beforeEach(async () => {
    await q(`truncate works, authors, series, locations cascade`);
    home = await value(`insert into locations(name, type) values ('Amsterdam', 'physical') returning id`);
    digital = await value(`insert into locations(name, type) values ('Kindle', 'digital') returning id`);
  });
  const book = (title: string, { rating = null as number | null, status = "accessioned", seriesId = null as string | null, position = null as string | null } = {}) =>
    value(`insert into works(title, slug, rating, catalogue_status, series_id, series_position) values ($1, $2, $3, $4, $5, $6) returning id`, [
      title,
      `book-${++serial}`,
      rating,
      status,
      seriesId,
      position,
    ]);
  const copy = async (workId: string, status = "available", { at = home, lentTo = null as string | null, lentDate = null as string | null } = {}) => {
    const e = await value(`insert into editions(work_id, title, language) values ($1, 'E', 'en') returning id`, [workId]);
    await q(`insert into instances(edition_id, location_id, status, lent_to, lent_date) values ($1, $2, $3, $4, $5)`, [e, at, status, lentTo, lentDate]);
  };
  interface Read {
    status?: string;
    finished?: [string, string];
    rating?: number;
    percent?: number;
    lastReadAt?: string;
  }
  const read = (workId: string, r: Read = {}) =>
    q(
      `insert into readings(work_id, status, started_precision, finished_on, finished_precision, rating, current_percent, last_read_at)
       values ($1, $2, 'unknown', $3, $4, $5, $6, $7)`,
      [workId, r.status ?? "finished", r.finished?.[0] ?? null, r.finished?.[1] ?? "unknown", r.rating ?? null, r.percent ?? null, r.lastReadAt ?? null],
    );
  /** The titles a filter keeps; sorted by title in JavaScript unless a sort's order is under test */
  const ids = async (filters: WorkFilters, sort?: "lastRead" | "rating") => {
    const titles = (await getWorks({ filters, sort: sort ?? "title", limit: 100 })).map((w) => w.title);
    return sort ? titles : titles.sort();
  };
  const fromUrl = (query: string) => parseReadingFilters(new URLSearchParams(query), { sorts: LIBRARY_SORTS }).filters;

  /** The library: owned and not, every reading state, re-reads, read in several years */
  async function library() {
    const unreadOwned = await book("Unread owned");
    await copy(unreadOwned);
    await copy(unreadOwned, "deaccessioned");
    const unreadGone = await book("Unread gone", { status: "deaccessioned" });
    await copy(unreadGone, "deaccessioned");
    const reading = await book("Reading owned");
    await copy(reading, "lent_out");
    await read(reading, { status: "reading", percent: 44.17, lastReadAt: "2026-09-30T10:00:00Z" });
    const paused = await book("Paused wanted", { status: "wanted" });
    await read(paused, { status: "paused", percent: 10 });
    const readDay = await book("Read 2024 day", { rating: 4 });
    await copy(readDay);
    await read(readDay, { finished: ["2024-04-14", "day"], rating: 2 });
    const readMonth = await book("Read 2025 month");
    await read(readMonth, { finished: ["2025-03-01", "month"] });
    const reread = await book("Re-read 2019 year", { rating: 5 });
    await copy(reread, "available", { at: digital });
    await read(reread, { finished: ["2010-01-01", "year"] });
    await read(reread, { finished: ["2019-01-01", "year"] });
    const abandoned = await book("Abandoned", { rating: 3 });
    await read(abandoned, { status: "abandoned", finished: ["2021-06-01", "month"] });
    return { unreadOwned, unreadGone, reading, paused, readDay, readMonth, reread, abandoned };
  }

  it("filters by reading state, alone and with holding=owned", async () => {
    await library();
    expect(await ids({ reading: ["unread"] })).toEqual(["Unread gone", "Unread owned"]);
    expect(await ids({ reading: ["unread"], holding: "owned" })).toEqual(["Unread owned"]);
    expect(await ids(fromUrl("reading=unread&holding=owned"))).toEqual(["Unread owned"]);
    expect(await ids({ reading: ["reading", "paused"] })).toEqual(["Paused wanted", "Reading owned"]);
    expect(await ids({ reading: ["reading", "paused"], holding: "owned" })).toEqual(["Reading owned"]);
    expect(await ids({ reading: ["read"] })).toEqual(["Re-read 2019 year", "Read 2024 day", "Read 2025 month"]);
    expect(await ids({ reading: ["read"], holding: "owned" })).toEqual(["Re-read 2019 year", "Read 2024 day"]);
    expect(await ids({ reading: ["abandoned"] })).toEqual(["Abandoned"]);
    expect(await getWorkCount(undefined, { reading: ["unread"], holding: "owned" })).toBe(1);
  });

  it("holds a book with any copy not deaccessioned; not_owned is the rest; both is no filter", async () => {
    await library();
    const owned = await ids({ holding: "owned" });
    expect(owned).toEqual(["Re-read 2019 year", "Read 2024 day", "Reading owned", "Unread owned"]);
    const notOwned = await ids({ holding: "not_owned" });
    expect(notOwned).toEqual(["Abandoned", "Paused wanted", "Read 2025 month", "Unread gone"]);
    expect(await ids(fromUrl("holding=owned,not_owned"))).toHaveLength(8);
    expect(owned.length + notOwned.length).toBe(8);
  });

  it("reads in a year range at any precision, re-reads, and sorts by last read with never-read last", async () => {
    await library();
    expect(await ids({ readFrom: 2024, readTo: 2024 })).toEqual(["Read 2024 day"]);
    expect(await ids({ readFrom: 2025 })).toEqual(["Read 2025 month"]);
    expect(await ids({ readTo: 2019 })).toEqual(["Re-read 2019 year"]);
    // An abandoned stop is not a read
    expect(await ids({ readFrom: 2021, readTo: 2021 })).toEqual([]);
    expect(await ids(fromUrl("readFrom=2025&readTo=2019"))).toEqual(["Re-read 2019 year", "Read 2024 day", "Read 2025 month"]);
    expect(await ids({ reread: true })).toEqual(["Re-read 2019 year"]);
    expect(await ids({ reread: true, holding: "owned" })).toEqual(["Re-read 2019 year"]);
    const lastRead = await ids({}, "lastRead");
    expect(lastRead.slice(0, 5)).toEqual(["Reading owned", "Read 2025 month", "Read 2024 day", "Abandoned", "Re-read 2019 year"]);
    expect(lastRead.slice(5).sort()).toEqual(["Paused wanted", "Unread gone", "Unread owned"].sort());
  });

  it("uses the book's rating for the minimum and the Rating sort, never a reading's", async () => {
    await library();
    // Read 2024 day: the book is rated 4, its reading 2
    expect(await ids({ minRating: 4 })).toEqual(["Re-read 2019 year", "Read 2024 day"].sort());
    expect((await ids({}, "rating")).slice(0, 3)).toEqual(["Re-read 2019 year", "Read 2024 day", "Abandoned"]);
  });

  it("returns the open reading's state and percent as numbers, in the list's one query", async () => {
    await library();
    const rows = await getWorks({ filters: {}, sort: "title", limit: 100 });
    const reading = rows.find((r) => r.title === "Reading owned")!;
    expect(reading.readingState).toBe("reading");
    expect(reading.readingPercent).toBe(44.17);
    expect(typeof reading.readingPercent).toBe("number");
    const reread = rows.find((r) => r.title === "Re-read 2019 year")!;
    expect(reread.timesRead).toBe(2);
    expect(typeof reread.timesRead).toBe("number");
    expect(reread.lastFinishedOn).toBe("2019-01-01");
    expect(reread.lastFinishedPrecision).toBe("year");
    // The timeline takes the same filters back from the browser
    await q(`update works set original_year = 1950`);
    expect((await getWorksForTimeline({ filters: { reading: ["unread"], holding: "owned" } })).map((w) => w.title)).toEqual(["Unread owned"]);
  });

  it("summarizes a page of books for the list and the table", async () => {
    const w = await library();
    const summaries = await getReadingSummaries([w.reading, w.reread, w.unreadOwned]);
    expect(summaries[w.reading]).toMatchObject({ state: "reading", timesRead: 0, percent: 44.17 });
    expect(summaries[w.reread]).toMatchObject({ state: "read", timesRead: 2, lastFinishedOn: "2019-01-01", lastFinishedPrecision: "year", percent: null });
    expect(summaries[w.reread].lastReadAt).toMatch(/^2019-01-01/);
    expect(summaries[w.unreadOwned]).toMatchObject({ state: "unread", timesRead: 0, lastReadAt: null });
    await expect(getReadingSummaries(Array.from({ length: 101 }, () => w.reading))).rejects.toThrow();
  });

  it("counts an author's books read, a book being re-read included, and averages the books' ratings", async () => {
    const a = await value(`insert into authors(name, slug) values ('Samuel Beckett', 'samuel-beckett') returning id`);
    const watt = await book("Watt", { rating: 4.5 });
    const molloy = await book("Molloy", { rating: 3 });
    const murphy = await book("Murphy");
    for (const w of [watt, molloy, murphy]) await q(`insert into work_authors(work_id, author_id, role) values ($1, $2, 'author')`, [w, a]);
    await read(watt, { finished: ["2010-01-01", "year"] });
    // Being re-read: still read
    await read(watt, { status: "reading", percent: 20 });
    await read(molloy, { finished: ["2020-05-01", "month"], rating: 1 });
    const author = await getAuthorBySlug("samuel-beckett");
    const works = author!.workAuthors.map((wa) => wa.work);
    expect(works.find((w) => w.title === "Watt")).toMatchObject({ readingState: "reading", timesRead: 1, readingPercent: 20 });
    const record = readingRecordOf(works);
    expect(record).toMatchObject({ total: 3, read: 2, rereads: 0, average: 3.8 });
    expect(typeof record.average).toBe("number");
  });

  it("counts a series' volumes read and names the next to read, with where its copy is", async () => {
    const s = await value(`insert into series(title, slug) values ('Les Rougon-Macquart', 'rougon') returning id`);
    const v1 = await book("La Fortune des Rougon", { seriesId: s, position: "1" });
    const v2 = await book("La Curée", { seriesId: s, position: "2" });
    const v3 = await book("Le Ventre de Paris", { seriesId: s, position: "3", status: "wanted" });
    const v5 = await book("L'Assommoir", { seriesId: s, position: "5" });
    await read(v1, { finished: ["2001-01-01", "year"] });
    // A gap: volume 2 unread, volume 3 abandoned, then 5 finished
    await read(v3, { status: "abandoned", finished: ["2002-01-01", "year"] });
    await read(v5, { finished: ["2003-01-01", "year"] });
    const detail = await getSeriesDetail(s);
    expect(detail!.works.filter((w) => Number(w.timesRead) >= 1).map((w) => w.title)).toEqual(["La Fortune des Rougon", "L'Assommoir"]);
    // After the last finished volume nothing is left
    expect(await getSeriesNextToRead(s)).toBeNull();
    // A sixth volume, lent out
    const v6 = await book("Nana", { seriesId: s, position: "6" });
    await copy(v6, "lent_out", { lentTo: "M.", lentDate: "2026-05-03" });
    expect(await getSeriesNextToRead(s)).toMatchObject({ id: v6, position: "6", whereabouts: expect.stringMatching(/^Lent to M\. since 3 May/) });
    // An available physical copy wins over the lent one; no copy reads "Not owned · Wanted"
    await copy(v6, "available");
    expect((await getSeriesNextToRead(s))!.whereabouts).toBe("On your shelf in Amsterdam");
    await q(`delete from readings where work_id = $1`, [v5]);
    expect(await getSeriesNextToRead(s)).toMatchObject({ id: v2 });
    await q(`update works set catalogue_status = 'wanted' where id = $1`, [v2]);
    expect((await getSeriesNextToRead(s))!.whereabouts).toBe("Not owned · Wanted");
  });

  it("answers GET /api/works with the reading filters, their total and each work's reading", async () => {
    await library();
    const call = async (query: string) => {
      const res = await listWorks(new NextRequest(`http://localhost/api/works?${query}`));
      return { status: res.status, body: await res.json() };
    };
    const owned = await call("reading=unread&holding=owned&sort=lastRead");
    expect(owned.status).toBe(200);
    expect(owned.body.works.map((w: { title: string }) => w.title)).toEqual(["Unread owned"]);
    expect(owned.body.total).toBe(1);
    const reading = await call("reading=reading&sort=rating");
    expect(reading.body.works[0].reading).toEqual({ state: "reading", timesRead: 0, lastFinishedOn: null, lastFinishedPrecision: null, percent: 44.17 });
    expect(typeof reading.body.works[0].reading.percent).toBe("number");
    expect((await call("readFrom=2024&readTo=2025")).body.total).toBe(2);
    expect((await call("reread=true")).body.total).toBe(1);
    expect((await call("status=wanted")).body.total).toBe(1);
    expect((await call("holding=not_owned&limit=2")).body).toMatchObject({ total: 4 });
    for (const bad of ["status=owned", "reading=someday", "sort=pages", "holding=mine", "readFrom=soon", "sort=authorLastName"]) {
      const res = await call(bad);
      expect(res.status, bad).toBe(400);
      expect(res.body.issues.length, bad).toBeGreaterThan(0);
    }
  });
});
