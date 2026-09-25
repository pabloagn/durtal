import { readFileSync } from "node:fs";
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
const url = process.env.DURTAL_HUNT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln315_test"
  ) {
    throw new Error(
      "Hunting tests require a disposable local sln315_test database",
    );
  }
}
const client = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
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
  invalidate: vi.fn(),
  CACHE_TAGS: { works: "works", activity: "activity" },
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { updateHuntAssessment } from "@/lib/actions/hunting";
import { getWorks, getWorkCount } from "@/lib/actions/works";
import { getWorksForTimeline } from "@/lib/actions/work-timeline";
import { recordActivity } from "@/lib/activity/record";

describe.skipIf(!url)("hunting with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE works CASCADE`);
    vi.clearAllMocks();
  });
  async function book() {
    return (
      await db
        .insert(schema.works)
        .values({
          title: "A wanted book",
          originalYear: 1944,
          catalogueStatus: "wanted",
          acquisitionPriority: "high",
          rating: 4,
          notes: "Preserve this",
        })
        .returning()
    )[0];
  }
  async function read(id: string) {
    return (
      await db.select().from(schema.works).where(eq(schema.works.id, id))
    )[0];
  }
  it("migrates both legacy labels to true and preserves dates and unrelated values", async () => {
    await client!.begin(async (tx) => {
      await tx.unsafe(
        `CREATE TEMP TABLE works (title text, hunt_difficulty text, hunt_assessed_on date, CONSTRAINT works_hunt_assessment_check CHECK (true)) ON COMMIT DROP`,
      );
      await tx.unsafe(
        `INSERT INTO works VALUES ('first', 'rare', '2024-02-29'), ('second', 'difficult_to_hunt', '2025-03-01'), ('third', NULL, NULL)`,
      );
      for (const statement of readFileSync(
        "src/lib/db/migrations/0024_rare_boolean.sql",
        "utf8",
      ).split("--> statement-breakpoint"))
        await tx.unsafe(statement);
      const rows = await tx.unsafe(
        `SELECT title, is_rare, hunt_assessed_on::text AS marked_on FROM works ORDER BY title`,
      );
      expect([...rows]).toEqual([
        { title: "first", is_rare: true, marked_on: "2024-02-29" },
        { title: "second", is_rare: true, marked_on: "2025-03-01" },
        { title: "third", is_rare: false, marked_on: null },
      ]);
    });
  });
  it("defaults existing-style books to unmarked, saves and reassesses without touching metadata", async () => {
    const original = await book();
    expect(original.isRare).toBe(false);
    expect(original.huntAssessedOn).toBeNull();
    await updateHuntAssessment(original.id, {
      isRare: true,
      huntAssessedOn: "2025-04-01",
    });
    expect(await read(original.id)).toMatchObject({
      isRare: true,
      huntAssessedOn: "2025-04-01",
    });
    await updateHuntAssessment(original.id, {
      isRare: true,
      huntAssessedOn: "2026-09-25",
    });
    const updated = await read(original.id);
    expect(updated).toEqual({
      ...original,
      isRare: true,
      huntAssessedOn: "2026-09-25",
      updatedAt: updated.updatedAt,
    });
    expect(recordActivity).toHaveBeenLastCalledWith(
      "work",
      original.id,
      "work.hunt_assessment_changed",
      { newValue: "Rare · 2026-09-25" },
    );
  });
  it("clears the pair and preserves the book", async () => {
    const original = await book();
    await updateHuntAssessment(original.id, {
      isRare: true,
      huntAssessedOn: "2026-09-25",
    });
    await updateHuntAssessment(original.id, {
      isRare: false,
      huntAssessedOn: null,
    });
    expect(await read(original.id)).toMatchObject({
      title: original.title,
      catalogueStatus: "wanted",
      isRare: false,
      huntAssessedOn: null,
    });
  });
  it("rejects invalid input and missing books before recording activity", async () => {
    const original = await book();
    await expect(
      updateHuntAssessment(original.id, {
        isRare: true,
        huntAssessedOn: "2025-02-29",
      }),
    ).rejects.toThrow();
    await expect(
      updateHuntAssessment("not-a-uuid", {
        isRare: false,
        huntAssessedOn: null,
      }),
    ).rejects.toThrow();
    await expect(
      updateHuntAssessment("00000000-0000-4000-8000-000000000000", {
        isRare: false,
        huntAssessedOn: null,
      }),
    ).rejects.toThrow("Book not found");
    expect(await read(original.id)).toEqual(original);
    expect(recordActivity).not.toHaveBeenCalled();
  });
  it("enforces paired fields and supported values at the database boundary", async () => {
    const original = await book();
    for (const fields of [
      sql`is_rare = true`,
      sql`hunt_assessed_on = '2026-09-25'`,
      sql`is_rare = NULL`,
    ]) {
      await expect(
        db.execute(sql`UPDATE works SET ${fields} WHERE id = ${original.id}`),
      ).rejects.toThrow();
    }
    expect(await read(original.id)).toEqual(original);
  });
  it("filters results, count and timeline consistently and combines with wishlist status", async () => {
    const rare = await book();
    const difficult = await book();
    await book();
    await updateHuntAssessment(rare.id, {
      isRare: true,
      huntAssessedOn: "2025-01-01",
    });
    await updateHuntAssessment(difficult.id, {
      isRare: true,
      huntAssessedOn: "2026-01-01",
    });
    const filters = { isRare: true, catalogueStatus: ["wanted"] };
    expect((await getWorks({ filters })).map((w) => w.id).sort()).toEqual(
      [rare.id, difficult.id].sort(),
    );
    expect(await getWorkCount(undefined, filters)).toBe(2);
    expect(
      (await getWorksForTimeline({ filters })).map((w) => w.id).sort(),
    ).toEqual([rare.id, difficult.id].sort());
    expect(await getWorkCount(undefined, { isRare: false })).toBe(1);
    expect(
      await getWorkCount(undefined, {
        ...filters,
        catalogueStatus: ["accessioned"],
      }),
    ).toBe(0);
  });
});
