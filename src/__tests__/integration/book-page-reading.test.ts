import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_BOOK_PAGE_READING_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln447_book_page_reading");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln447_book_page_reading")
    throw new Error("Book page reading tests require a disposable local sln447_book_page_reading database");
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
import { atHandCopySql, isAtHand } from "@/lib/reading/at-hand";
import { nextToRead } from "@/lib/reading/series-next";
import { queryBookReadingOverview, queryReadingChoices, queryReadingChoice } from "@/lib/reading/overview";
import { readingRecord } from "@/lib/reading/labels";
import { readingRecordFromSummary } from "@/lib/reading/overview-summary";
import { getReadingsForWork, getNextInSeries } from "@/lib/actions/reading";

describe.skipIf(!url)("the book page's reading rules with PostgreSQL", () => {
  const db = testDb!;
  const dialect = new PgDialect();
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln447_book_page_reading");
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln447_book_page_reading", { emptyLocations: true });
  }, 30000);

  let serial = 0;
  const book = (title: string, seriesId: string | null = null, position: string | null = null) =>
    value(`insert into works(title, slug, series_id, series_position) values ($1, $2, $3, $4) returning id`, [title, `${title.toLowerCase().replace(/\W+/g, "-")}-${++serial}`, seriesId, position]);
  const edition = (workId: string) => value(`insert into editions(work_id, title, language) values ($1, 'E', 'en') returning id`, [workId]);
  const place = (name: string, type = "physical") => value(`insert into locations(name, type) values ($1, $2) returning id`, [name, type]);

  it("agrees with isAtHand for a copy of every status at the home, at another home and at a digital place", async () => {
    const workId = await book("Watt");
    const e = await edition(workId);
    const ams = await place("Amsterdam");
    const mex = await place("Mexico City");
    const kindle = await place("Kindle", "digital");
    const statuses = ["available", "lent_out", "in_transit", "in_storage", "missing", "damaged", "deaccessioned"];
    const copies: { id: string; status: string; locationId: string; locationType: string }[] = [];
    for (const [locationId, locationType] of [[ams, "physical"], [mex, "physical"], [kindle, "digital"]] as const)
      for (const status of statuses)
        copies.push({
          id: await value(`insert into instances(edition_id, location_id, status) values ($1, $2, $3) returning id`, [e, locationId, status]),
          status,
          locationId,
          locationType,
        });
    for (const home of [ams, mex, null]) {
      const query = dialect.sqlToQuery(sql`select id from (${atHandCopySql(workId, home)}) a`);
      const found = (await q(query.sql, query.params)).map((r) => r.id).sort();
      const expected = copies.filter((c) => isAtHand(c, home)).map((c) => c.id).sort();
      expect(found, `home ${home}`).toEqual(expected);
    }
    // Physical copies at the home come first
    const first = dialect.sqlToQuery(sql`select (${atHandCopySql(workId, ams)} limit 1) as id`);
    expect((await q(first.sql, first.params))[0].id).toBe(copies[0].id);
  });

  it("finds the next volume of a series to read, with where its copy is", async () => {
    const seriesId = await value(`insert into series(title, slug) values ('Les Rougon-Macquart', 'rougon-${++serial}') returning id`);
    const v1 = await book("La Fortune des Rougon", seriesId, "1");
    const v2 = await book("La Curée", seriesId, "2");
    const v10 = await book("L'Assommoir", seriesId, "10");
    const blank = await book("Hors série", seriesId, null);
    expect((await nextToRead(seriesId))?.id).toBe(v1);
    await q(`insert into readings(work_id, status, started_precision, finished_on, finished_precision) values ($1, 'finished', 'unknown', '2020-01-01', 'year')`, [v1]);
    expect((await nextToRead(seriesId))?.id).toBe(v2);
    // A volume under way is not the next to read: the one after it is (SLN-918)
    await q(`insert into readings(work_id, status, started_precision) values ($1, 'reading', 'unknown')`, [v2]);
    expect((await nextToRead(seriesId))?.id).toBe(v10);
    await q(`delete from readings where work_id = $1`, [v2]);
    expect((await nextToRead(seriesId))?.id).toBe(v2);
    await q(`insert into readings(work_id, status, started_precision, finished_on, finished_precision) values ($1, 'finished', 'unknown', '2021-01-01', 'year')`, [v10]);
    expect((await nextToRead(seriesId))?.id).toBe(blank);
    // Where La Curée's copy is, from the finished first volume's page
    await q(`delete from readings where work_id = $1`, [v10]);
    const ams = await place("Amsterdam");
    const shelf = await value(`insert into sub_locations(location_id, name) values ($1, 'Study, shelf 3') returning id`, [ams]);
    await q(`insert into instances(edition_id, location_id, sub_location_id, status) values ($1, $2, $3, 'available')`, [await edition(v2), ams, shelf]);
    expect(await getNextInSeries(v1, ams)).toMatchObject({ id: v2, title: "La Curée", seriesTitle: "Les Rougon-Macquart", whereabouts: "On your shelf in Amsterdam, Study, shelf 3" });
    expect(await getNextInSeries(v1, null)).toMatchObject({ whereabouts: "On your shelf in Amsterdam, Study, shelf 3" });
    const noSeries = await book("Alone");
    expect(await getNextInSeries(noSeries, ams)).toBeNull();
  });
  it("bounds details while preserving every history aggregate, fingerprint, ordinal and default", async () => {
    const workId = await book("Bounded history");
    const oldEdition = await edition(workId);
    const newerEdition = await edition(workId);
    const ids: string[] = [];
    for (let i=0; i<25; i++) ids.push(await value(`insert into readings(work_id,edition_id,status,started_on,started_precision,finished_on,finished_precision,total_minutes,rating,review_html)
      values ($1,$2,'finished',$3,'year',$4,'day',$5,$6,$7) returning id`, [workId,i===0 || i===20 ? oldEdition : i===21 ? newerEdition : null,`${1990+i}-01-01`,`${1990+i}-02-01`,i===0?580:null,i%3===0?4:null,"<p>"+"Long historical review. ".repeat(100)+"</p>"]));
    const open = await value(`insert into readings(work_id,edition_id,started_precision) values ($1,$2,'unknown') returning id`,[workId,newerEdition]);
    await q(`insert into reading_sessions(reading_id,read_on,duration_seconds,source,format,time_zone) values ($1,'1990-02-01',11520,'manual','print','Europe/Amsterdam')`,[ids[0]]);
    const all = await getReadingsForWork(workId);
    const bounded = await queryBookReadingOverview(workId);
    expect(bounded.rows).toHaveLength(5);
    expect(bounded.rows[0].reading.id).toBe(open);
    expect(bounded.summary).toMatchObject({readingCount:26,openCount:1,finishedCount:25,sessionCount:1,state:"reading"});
    expect(readingRecordFromSummary(bounded.summary)).toEqual(readingRecord(all));
    expect(bounded.defaults).toEqual({lastEditionId:newerEdition,latestMinutesByEdition:{[oldEdition]:580}});
    expect(bounded.history).toEqual({closedCount:25,hasMore:true});
    for (const row of bounded.rows) {
      const original = all.find(item=>item.reading.id===row.reading.id)!;
      expect(row.fingerprint).toBe(original.fingerprint);
      expect(row.ordinal).toBe(original.ordinal);
    }
    expect(bounded.rows.at(-1)?.previousClosed).toEqual({editionId:oldEdition});
    const oldest = await queryBookReadingOverview(workId,ids[0]);
    expect(oldest.rows).toHaveLength(6);
    expect(oldest.rows.find(row=>row.reading.id===ids[0])?.fingerprint).toBe(all.find(row=>row.reading.id===ids[0])?.fingerprint);
    const first = await queryReadingChoices(workId);
    const second = await queryReadingChoices(workId,2);
    expect(first).toMatchObject({total:26,page:1,hasNext:true});
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(6);
    expect(new Set([...first.items,...second.items].map(row=>row.id)).size).toBe(26);
    expect(await queryReadingChoice(workId,ids[0])).toMatchObject({id:ids[0],ordinal:all.find(row=>row.reading.id===ids[0])!.ordinal});
    expect((await queryReadingChoices(workId,1,"%" )).items).toEqual([]);
    const other = await book("Other work");
    expect(await queryReadingChoice(other,ids[0])).toBeNull();
    await expect(queryBookReadingOverview(other,ids[0])).rejects.toThrow("no longer exists");
  });

  it("keeps a latest abandoned reading resumable after older finished history", async () => {
    const workId = await book("Latest abandoned");
    await q(`insert into readings(work_id,status,started_precision,finished_on,finished_precision) values ($1,'finished','unknown','2020-01-01','year')`,[workId]);
    const abandoned = await value(`insert into readings(work_id,status,started_precision,finished_on,finished_precision) values ($1,'abandoned','unknown','2024-01-01','year') returning id`,[workId]);
    expect((await queryBookReadingOverview(workId)).summary).toMatchObject({state:"abandoned",latestClosedId:abandoned,finishedCount:1});
  });

  it("matches legacy known-date fallback even with inconsistent imported precision", async () => {
    const workId = await book("Legacy unknown dates");
    // This intentionally inconsistent legacy row needs a temporary relaxation
    // in this disposable database only; restore the constraint in finally.
    await q(`alter table readings drop constraint reading_precision_check`);
    try {
      await q(`insert into readings(work_id,status,started_on,started_precision,finished_on,finished_precision) values
        ($1,'finished','1900-01-01','unknown','2020-06-01','month'),
        ($1,'finished','1800-01-01','unknown','1801-01-01','unknown')`,[workId]);
      const all = await getReadingsForWork(workId);
      const bounded = await queryBookReadingOverview(workId);
      expect(bounded.summary.record.firstKnown).toEqual({date:"2020-06-01",precision:"month"});
      expect(readingRecordFromSummary(bounded.summary)).toEqual(readingRecord(all));
    } finally {
      await q(`delete from readings where work_id=$1`,[workId]);
      await q(`alter table readings add constraint reading_precision_check check ((started_on is null)=(started_precision='unknown') and (finished_on is null)=(finished_precision='unknown'))`);
    }
  });

  it("refuses duplicate open history instead of silently picking a row", async () => {
    const workId = await book("Invalid duplicate open");
    await q(`drop index reading_open_unique`);
    try {
      await q(`insert into readings(work_id,status,started_precision) values ($1,'reading','unknown'),($1,'paused','unknown')`,[workId]);
      await expect(queryBookReadingOverview(workId)).rejects.toThrow("more than one open reading");
    } finally {
      await q(`delete from readings where work_id=$1`,[workId]);
      await q(`create unique index reading_open_unique on readings(work_id) where status in ('reading','paused')`);
    }
  });

});
