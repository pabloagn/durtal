import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { works } from "@/lib/db/schema";
import { getWorkPages, pageRangeCondition, pagesUnknownCondition } from "@/lib/enrichment/pages";
import { assertReadOnly, readOnlySession } from "@/lib/enrichment/read-only-session";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_LENGTH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln466_length")
    throw new Error("Length tests require disposable local sln466_length");
}
const sql = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;

describe.skipIf(!url)("the page rule with PostgreSQL", () => {
  const db = sql!;
  const database = drizzle(db);
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const migrator = postgres(url!, { max: 1, onnotice: () => {} });
    await migrate(drizzle(migrator, { schema }), { migrationsFolder: "src/lib/db/migrations" });
    await migrator.end();
  });
  afterAll(async () => {
    await sql?.end();
  });

  /** A work with one edition per page count, each with copies of the given status at the given location */
  async function work(title: string, copies: { pages: number | null; status?: string; at?: string }[]) {
    const [w] = await db`insert into works (title) values (${title}) returning id`;
    for (const copy of copies) {
      const [e] = await db`insert into editions (work_id, title, page_count) values (${w.id}, ${title}, ${copy.pages}) returning id`;
      if (copy.at)
        await db`insert into instances (edition_id, location_id, status) values (${e.id}, ${ids[copy.at]}, ${copy.status ?? "available"})`;
    }
    return w.id as string;
  }

  beforeEach(async () => {
    await db`truncate works, locations cascade`;
    const [amsterdam] = await db`insert into locations (name, type) values ('Amsterdam', 'physical') returning id`;
    const [mexico] = await db`insert into locations (name, type) values ('Mexico City', 'physical') returning id`;
    ids.amsterdam = amsterdam.id;
    ids.mexico = mexico.id;
    // A deaccessioned copy of a 900-page edition; the owned edition has 300
    ids.deaccessioned = await work("Deaccessioned", [
      { pages: 900, at: "amsterdam", status: "deaccessioned" },
      { pages: 300, at: "mexico" },
    ]);
    ids.range = await work("Two owned editions", [
      { pages: 448, at: "amsterdam" },
      { pages: 512, at: "mexico" },
    ]);
    // Amsterdam's copy is lent out; Mexico City's is available
    ids.lent = await work("Lent in Amsterdam", [
      { pages: 450, at: "amsterdam", status: "lent_out" },
      { pages: 300, at: "mexico" },
    ]);
    ids.implausible = await work("Implausible counts", [
      { pages: 5, at: "amsterdam" },
      { pages: 4000, at: "amsterdam" },
      { pages: 420, at: "amsterdam" },
    ]);
    ids.wanted = await work("Not owned", [{ pages: 250 }, { pages: 610 }]);
    // Owned, without a count; the edition not owned has one
    ids.unknown = await work("Owned without a count", [{ pages: null, at: "amsterdam" }, { pages: 350 }]);
    ids.onlyImplausible = await work("Only an implausible count", [{ pages: 9999, at: "amsterdam" }]);
  });

  async function select(condition: ReturnType<typeof pageRangeCondition>) {
    const rows = await database.select({ id: works.id }).from(works).where(condition).orderBy(asc(works.id));
    return rows.map((r) => r.id).sort();
  }

  it("ignores deaccessioned copies", async () => {
    const pages = await getWorkPages(database, [ids.deaccessioned]);
    expect(pages.get(ids.deaccessioned)).toMatchObject({ min: 300, max: 300, basis: "owned" });
  });

  it("gives the range of several owned editions", async () => {
    const pages = await getWorkPages(database, [ids.range]);
    expect(pages.get(ids.range)).toMatchObject({ min: 448, max: 512, basis: "owned" });
  });

  it("reads only available copies at the location", async () => {
    const pages = await getWorkPages(database, [ids.range, ids.lent, ids.deaccessioned], { locationId: ids.amsterdam });
    expect(pages.get(ids.range)).toMatchObject({ min: 448, max: 448, basis: "location" });
    expect(pages.has(ids.lent)).toBe(false);
    expect(pages.has(ids.deaccessioned)).toBe(false);
  });

  it("leaves out implausible counts", async () => {
    const pages = await getWorkPages(database, [ids.implausible]);
    expect(pages.get(ids.implausible)).toMatchObject({ min: 420, max: 420 });
  });

  it("gives a work that is not owned the range of all its editions", async () => {
    const pages = await getWorkPages(database, [ids.wanted]);
    expect(pages.get(ids.wanted)).toMatchObject({ min: 250, max: 610, basis: "any_edition" });
  });

  it("gives an owned work without a count no pages, even when an edition not owned has one", async () => {
    const pages = await getWorkPages(database, [ids.unknown]);
    expect(pages.get(ids.unknown)).toMatchObject({ min: null, max: null, basis: "owned", editions: [] });
  });

  it("puts owned works without a usable count under unknown, never in a range", async () => {
    const unknown = await select(pagesUnknownCondition({}));
    expect(unknown).toEqual([ids.unknown, ids.onlyImplausible].sort());
    const anyLength = await select(pageRangeCondition({}));
    expect(anyLength).not.toContain(ids.unknown);
    expect(anyLength).not.toContain(ids.onlyImplausible);
  });

  it("selects the same works through pageRangeCondition and getWorkPages", async () => {
    const all = Object.values(ids).filter((id) => id !== ids.amsterdam && id !== ids.mexico);
    for (const options of [{ min: 400, max: 600 }, { min: 400, max: 600, locationId: ids.amsterdam }, { max: 320 }]) {
      const pages = await getWorkPages(database, all, { locationId: options.locationId });
      const inRange = [...pages]
        .filter(([, p]) => p.editions.some((e) => e.pageCount >= (options.min ?? 0) && e.pageCount <= (options.max ?? Infinity)))
        .map(([id]) => id)
        .sort();
      expect(await select(pageRangeCondition(options))).toEqual(inRange);
    }
  });

  it("proves the plan's session refuses a write", async () => {
    const session = readOnlySession(url!);
    await expect(assertReadOnly(session)).resolves.toBeUndefined();
    await session.end();
    await expect(assertReadOnly(db)).rejects.toThrow("accepted a write");
  });
});
