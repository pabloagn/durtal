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
  it("defaults existing-style books to unmarked, saves and reassesses without touching metadata", async () => {
    const original = await book();
    expect(original.huntDifficulty).toBeNull();
    expect(original.huntAssessedOn).toBeNull();
    await updateHuntAssessment(original.id, {
      huntDifficulty: "rare",
      huntAssessedOn: "2025-04-01",
    });
    expect(await read(original.id)).toMatchObject({
      huntDifficulty: "rare",
      huntAssessedOn: "2025-04-01",
    });
    await updateHuntAssessment(original.id, {
      huntDifficulty: "difficult_to_hunt",
      huntAssessedOn: "2026-09-25",
    });
    const updated = await read(original.id);
    expect(updated).toEqual({
      ...original,
      huntDifficulty: "difficult_to_hunt",
      huntAssessedOn: "2026-09-25",
      updatedAt: updated.updatedAt,
    });
    expect(recordActivity).toHaveBeenLastCalledWith(
      "work",
      original.id,
      "work.hunt_assessment_changed",
      { newValue: "Difficult to Hunt · 2026-09-25" },
    );
  });
  it("clears the pair and preserves the book", async () => {
    const original = await book();
    await updateHuntAssessment(original.id, {
      huntDifficulty: "rare",
      huntAssessedOn: "2026-09-25",
    });
    await updateHuntAssessment(original.id, {
      huntDifficulty: null,
      huntAssessedOn: null,
    });
    expect(await read(original.id)).toMatchObject({
      title: original.title,
      catalogueStatus: "wanted",
      huntDifficulty: null,
      huntAssessedOn: null,
    });
  });
  it("rejects invalid input and missing books before recording activity", async () => {
    const original = await book();
    await expect(
      updateHuntAssessment(original.id, {
        huntDifficulty: "rare",
        huntAssessedOn: "2025-02-29",
      }),
    ).rejects.toThrow();
    await expect(
      updateHuntAssessment("not-a-uuid", {
        huntDifficulty: null,
        huntAssessedOn: null,
      }),
    ).rejects.toThrow();
    await expect(
      updateHuntAssessment("00000000-0000-4000-8000-000000000000", {
        huntDifficulty: null,
        huntAssessedOn: null,
      }),
    ).rejects.toThrow("Book not found");
    expect(await read(original.id)).toEqual(original);
    expect(recordActivity).not.toHaveBeenCalled();
  });
  it("enforces paired fields and supported values at the database boundary", async () => {
    const original = await book();
    for (const fields of [
      sql`hunt_difficulty = 'rare'`,
      sql`hunt_assessed_on = '2026-09-25'`,
      sql`hunt_difficulty = 'unknown', hunt_assessed_on = '2026-09-25'`,
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
      huntDifficulty: "rare",
      huntAssessedOn: "2025-01-01",
    });
    await updateHuntAssessment(difficult.id, {
      huntDifficulty: "difficult_to_hunt",
      huntAssessedOn: "2026-01-01",
    });
    const filters = { huntDifficulty: ["rare"], catalogueStatus: ["wanted"] };
    expect((await getWorks({ filters })).map((w) => w.id)).toEqual([rare.id]);
    expect(await getWorkCount(undefined, filters)).toBe(1);
    expect((await getWorksForTimeline({ filters })).map((w) => w.id)).toEqual([
      rare.id,
    ]);
    expect(
      await getWorkCount(undefined, {
        huntDifficulty: ["rare", "difficult_to_hunt"],
      }),
    ).toBe(2);
    expect(await getWorkCount(undefined, { huntDifficulty: ["unknown"] })).toBe(
      0,
    );
    expect(
      await getWorkCount(undefined, {
        ...filters,
        catalogueStatus: ["accessioned"],
      }),
    ).toBe(0);
  });
});
