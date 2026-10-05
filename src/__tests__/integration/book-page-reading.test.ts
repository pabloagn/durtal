import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_BOOK_PAGE_READING_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln447_book_page_reading")
    throw new Error("Book page reading tests require a disposable local sln447_book_page_reading database");
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
import { atHandCopySql, isAtHand } from "@/lib/reading/at-hand";
import { nextToRead } from "@/lib/reading/series";
import { getNextInSeries } from "@/lib/actions/reading";

describe.skipIf(!url)("the book page's reading rules with PostgreSQL", () => {
  const db = testDb!;
  const dialect = new PgDialect();
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await q(`truncate works, series, locations cascade`);
  });

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
});
