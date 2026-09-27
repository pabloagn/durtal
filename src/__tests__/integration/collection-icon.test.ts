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
const url = process.env.DURTAL_COLLECTION_ICON_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln336_test"
  )
    throw new Error(
      "Collection icon tests require disposable local sln336_test",
    );
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
import { invalidate } from "@/lib/cache";
import {
  getCollection,
  getCollections,
  setCollectionIcon,
} from "@/lib/actions/collections";

describe.skipIf(!url)("collection icons with PostgreSQL", () => {
  const db = testDb!;
  let id = "";
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate collections cascade`);
    vi.clearAllMocks();
    [{ id }] = await db
      .insert(schema.collections)
      .values({ name: "Occult" })
      .returning();
  });
  const stored = async () =>
    (await db.query.collections.findFirst({
      where: eq(schema.collections.id, id),
      columns: { icon: true },
    }))!.icon;

  it("starts without an icon, then sets, changes and clears it", async () => {
    expect(await stored()).toBeNull();
    expect(await setCollectionIcon(id, "Skull")).toEqual({ icon: "Skull" });
    expect(await stored()).toBe("Skull");
    expect(invalidate).toHaveBeenCalled();
    expect(await setCollectionIcon(id, "MoonStar")).toEqual({
      icon: "MoonStar",
    });
    expect((await getCollection(id))?.icon).toBe("MoonStar");
    expect((await getCollections()).map((c) => c.icon)).toEqual(["MoonStar"]);
    expect(await setCollectionIcon(id, null)).toEqual({ icon: null });
    expect(await stored()).toBeNull();
  });

  it("stores only real Lucide icon names", async () => {
    for (const bad of ["skull", "NotAnIcon", "", "toString", "__proto__"])
      await expect(setCollectionIcon(id, bad)).rejects.toThrow();
    await expect(setCollectionIcon(id, "Skull".repeat(20))).rejects.toThrow();
    expect(await stored()).toBeNull();
  });

  it("rejects a bad id or a missing collection", async () => {
    await expect(setCollectionIcon("nope", "Skull")).rejects.toThrow();
    await expect(
      setCollectionIcon("00000000-0000-4000-8000-000000000000", "Skull"),
    ).rejects.toThrow("Collection not found");
  });
});
