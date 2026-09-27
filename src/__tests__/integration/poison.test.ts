import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_POISON_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln335_test"
  )
    throw new Error("Poison tests require disposable local sln335_test");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local DB required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  cached: (fn: () => unknown) => fn,
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { setPoison, bulkSetPoison } from "@/lib/actions/poison";
import { getWorks, getWorkCount, getWorksWithMark } from "@/lib/actions/works";
import { getWorksForTimeline } from "@/lib/actions/work-timeline";
import { recordActivity } from "@/lib/activity/record";

describe.skipIf(!url)("poison mark with PostgreSQL", () => {
  const db = testDb!;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate works, authors cascade`);
    vi.clearAllMocks();
    for (const [title, year] of [
      ["Maldoror", 1869],
      ["Crash", 1973],
      ["Fictions", 1944],
    ] as const) {
      const [w] = await db
        .insert(schema.works)
        .values({ title, originalYear: year })
        .returning();
      ids[title] = w.id;
    }
  });
  const poisonOf = async (title: string) =>
    (await db.query.works.findFirst({
      where: eq(schema.works.id, ids[title]),
      columns: { isPoison: true, isRare: true, huntAssessedOn: true },
    }))!;

  it("defaults to unmarked and toggles one book without touching rarity", async () => {
    expect(await poisonOf("Crash")).toEqual({
      isPoison: false,
      isRare: false,
      huntAssessedOn: null,
    });
    expect(await setPoison(ids.Crash, true)).toEqual({ isPoison: true });
    expect((await poisonOf("Crash")).isPoison).toBe(true);
    expect(recordActivity).toHaveBeenCalledWith(
      "work",
      ids.Crash,
      "work.poison_changed",
      { newValue: "marked" },
    );

    // Marking again changes nothing and records nothing
    vi.clearAllMocks();
    expect(await setPoison(ids.Crash, true)).toEqual({ isPoison: true });
    expect(recordActivity).not.toHaveBeenCalled();

    expect(await setPoison(ids.Crash, false)).toEqual({ isPoison: false });
    expect(await poisonOf("Crash")).toEqual({
      isPoison: false,
      isRare: false,
      huntAssessedOn: null,
    });
    expect(recordActivity).toHaveBeenCalledWith(
      "work",
      ids.Crash,
      "work.poison_changed",
      { newValue: null },
    );
  });

  it("rejects bad input and unknown books", async () => {
    await expect(setPoison("nope", true)).rejects.toThrow();
    await expect(
      setPoison(ids.Crash, "yes" as unknown as boolean),
    ).rejects.toThrow();
    await expect(
      setPoison("00000000-0000-4000-8000-000000000000", true),
    ).rejects.toThrow("Book not found");
    await expect(bulkSetPoison([], true)).rejects.toThrow();
  });

  it("marks a selection in one statement and counts only changed books", async () => {
    await setPoison(ids.Maldoror, true);
    vi.clearAllMocks();
    expect(
      await bulkSetPoison([ids.Maldoror, ids.Crash, ids.Crash], true),
    ).toEqual({ updated: 1 });
    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect((await poisonOf("Crash")).isPoison).toBe(true);
    expect(
      await bulkSetPoison([ids.Maldoror, ids.Crash, ids.Fictions], false),
    ).toEqual({ updated: 2 });
    expect((await poisonOf("Maldoror")).isPoison).toBe(false);
  });

  it("lists other books with a mark for the book page rows, newest first", async () => {
    await bulkSetPoison([ids.Maldoror, ids.Crash, ids.Fictions], true);
    // Newest first: Fictions was added last
    await db
      .update(schema.works)
      .set({ createdAt: new Date("2020-01-01") })
      .where(eq(schema.works.id, ids.Maldoror));
    const titles = async (
      mark: "rare" | "poison",
      id: string,
      limit?: number,
    ) => (await getWorksWithMark(mark, id, limit)).map((w) => w.title);
    expect(await titles("poison", ids.Crash)).toEqual(["Fictions", "Maldoror"]);
    expect(await titles("poison", ids.Crash, 1)).toEqual(["Fictions"]);
    expect(await titles("rare", ids.Crash)).toEqual([]);
    // Card data comes with each work
    const [first] = await getWorksWithMark("poison", ids.Crash);
    expect(first.isPoison).toBe(true);
    expect(first.workAuthors).toEqual([]);
    await expect(
      getWorksWithMark("evil" as "rare", ids.Crash),
    ).rejects.toThrow();
    await expect(getWorksWithMark("rare", "nope")).rejects.toThrow();
  });

  it("filters by marks: any of the chosen marks, like other groups", async () => {
    await setPoison(ids.Crash, true);
    await db
      .update(schema.works)
      .set({ isRare: true, huntAssessedOn: "2026-09-27" })
      .where(eq(schema.works.id, ids.Fictions));
    const titles = async (marks: ("rare" | "poison")[]) =>
      (await getWorks({ sort: "title", order: "asc", filters: { marks } })).map(
        (w) => w.title,
      );
    expect(await titles(["poison"])).toEqual(["Crash"]);
    expect(await titles(["rare"])).toEqual(["Fictions"]);
    expect(await titles(["rare", "poison"])).toEqual(["Crash", "Fictions"]);
    expect(await titles([])).toHaveLength(3);
    expect(await getWorkCount(undefined, { marks: ["rare", "poison"] })).toBe(
      2,
    );
    expect(
      (await getWorksForTimeline({ filters: { marks: ["rare"] } })).map(
        (w) => w.title,
      ),
    ).toEqual(["Fictions"]);
  });

  it("filters the library, its count and the timeline both ways", async () => {
    await bulkSetPoison([ids.Maldoror, ids.Crash], true);
    const titles = async (isPoison?: boolean) =>
      (
        await getWorks({ sort: "title", order: "asc", filters: { isPoison } })
      ).map((w) => w.title);
    expect(await titles(true)).toEqual(["Crash", "Maldoror"]);
    expect(await titles(false)).toEqual(["Fictions"]);
    expect(await titles(undefined)).toHaveLength(3);
    expect(await getWorkCount(undefined, { isPoison: true })).toBe(2);
    expect(await getWorkCount(undefined, { isPoison: false })).toBe(1);
    expect(
      (await getWorksForTimeline({ filters: { isPoison: false } })).map(
        (w) => w.title,
      ),
    ).toEqual(["Fictions"]);
  });
});
