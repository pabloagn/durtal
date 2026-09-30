import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import { WORK_KINDS, type WorkKind } from "@/lib/catalogue/kinds";
import { bookHoldings } from "@/lib/catalogue/holdings";

const url = process.env.DURTAL_CURATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln354_test"
  )
    throw new Error("Curation tests require disposable local sln354_test");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  cached: (fn: unknown) => fn,
  CACHE_TAGS: {},
}));
import { getWorkCuration, updateWorkCuration } from "@/lib/actions/curation";
import { requireBookWork } from "@/lib/catalogue/book-boundary";

describe.skipIf(!url)("shared personal curation", () => {
  const c = client!;
  let ids: Record<WorkKind, string>;
  let recommenderId: string;
  const owner = (kind: WorkKind = "painting") => ({ id: ids[kind], kind });
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, recommenders, locations cascade`;
    ids = {} as typeof ids;
    for (const kind of WORK_KINDS) {
      const [work] =
        await c`insert into works(title,kind,notes,rating) values (${kind},${kind},'Curated note',4) returning id`;
      ids[kind] = work.id;
    }
    const [recommender] =
      await c`insert into recommenders(name) values ('A friend') returning id`;
    recommenderId = recommender.id;
  });
  it.each(WORK_KINDS)(
    "curates %s without editions, holdings or acquisition changes",
    async (kind) => {
      const initial = (await getWorkCuration(owner(kind)))!;
      const saved = await updateWorkCuration({
        owner: owner(kind),
        fingerprint: initial.fingerprint,
        patch: {
          notes: "My taste",
          rating: 5,
          isFavourite: true,
          recommenderIds: [recommenderId, recommenderId],
        },
      });
      expect(saved).toMatchObject({
        notes: "My taste",
        rating: 5,
        isFavourite: true,
        recommenderIds: [recommenderId],
      });
      expect(saved.fingerprint).not.toBe(initial.fingerprint);
      expect(
        (
          await c`select catalogue_status,acquisition_priority from works where id=${ids[kind]}`
        )[0],
      ).toEqual({ catalogue_status: "tracked", acquisition_priority: "none" });
      expect(await c`select id from editions`).toHaveLength(0);
      expect(await c`select id from instances`).toHaveLength(0);
      const sparse = await updateWorkCuration({
        owner: owner(kind),
        fingerprint: saved.fingerprint,
        patch: { notes: null },
      });
      expect(sparse).toMatchObject({
        notes: null,
        rating: 5,
        isFavourite: true,
        recommenderIds: [recommenderId],
      });
    },
  );
  it("rolls back all personal fields when a recommendation reference fails", async () => {
    const before = (await getWorkCuration(owner()))!;
    await expect(
      updateWorkCuration({
        owner: owner(),
        fingerprint: before.fingerprint,
        patch: {
          notes: "Should roll back",
          isFavourite: true,
          recommenderIds: [randomUUID()],
        },
      }),
    ).rejects.toThrow();
    expect(await getWorkCuration(owner())).toEqual(before);
  });
  it("rejects stale and simultaneous edits instead of losing reviewed curation", async () => {
    const before = (await getWorkCuration(owner()))!;
    const outcomes = await Promise.allSettled(
      ["First", "Second"].map((notes) =>
        updateWorkCuration({
          owner: owner(),
          fingerprint: before.fingerprint,
          patch: { notes },
        }),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(
      updateWorkCuration({
        owner: owner(),
        fingerprint: before.fingerprint,
        patch: { recommenderIds: [] },
      }),
    ).rejects.toThrow();
  });
  it("detects edits made through the existing book fields", async () => {
    const before = (await getWorkCuration(owner("book")))!;
    await c`update works set notes='Existing book editor',rating=3 where id=${ids.book}`;
    await expect(
      updateWorkCuration({
        owner: owner("book"),
        fingerprint: before.fingerprint,
        patch: { notes: "Stale notes" },
      }),
    ).rejects.toThrow();
    expect(await getWorkCuration(owner("book"))).toMatchObject({
      notes: "Existing book editor",
      rating: 3,
    });
  });
  it("rejects wrong-kind owners and unsupported lifecycle mutations", async () => {
    const before = (await getWorkCuration(owner()))!;
    expect(
      await getWorkCuration({ kind: "book", id: ids.painting }),
    ).toBeNull();
    await expect(
      updateWorkCuration({
        owner: { kind: "book", id: ids.painting },
        fingerprint: before.fingerprint,
        patch: { notes: "Wrong domain" },
      }),
    ).rejects.toThrow();
    for (const kind of ["film", "perfume", "painting"] as const) {
      await expect(requireBookWork(ids[kind])).rejects.toThrow(
        "Book not found",
      );
      await expect(
        c`update works set catalogue_status='accessioned' where id=${ids[kind]}`,
      ).rejects.toThrow();
      await expect(
        c`update works set acquisition_priority='urgent' where id=${ids[kind]}`,
      ).rejects.toThrow();
    }
    expect(await getWorkCuration(owner())).toEqual(before);
  });
  it("preserves book lifecycle and active/deaccessioned copy ownership across curation edits", async () => {
    await c`update works set catalogue_status='wanted',acquisition_priority='urgent' where id=${ids.book}`;
    const [edition] =
      await c`insert into editions(work_id,title) values (${ids.book},'Edition') returning id`;
    const [location] =
      await c`insert into locations(name,type) values ('Home','physical') returning id`;
    await c`insert into instances(edition_id,location_id,status) values (${edition.id},${location.id},'available'),(${edition.id},${location.id},'deaccessioned')`;
    const before = (await getWorkCuration(owner("book")))!;
    await updateWorkCuration({
      owner: owner("book"),
      fingerprint: before.fingerprint,
      patch: { isFavourite: true },
    });
    const [work] = await testDb!
      .select()
      .from(schema.works)
      .where(eq(schema.works.id, ids.book));
    const copies = await testDb!.query.instances.findMany({
      with: { location: true },
    });
    expect(work).toMatchObject({
      catalogueStatus: "wanted",
      acquisitionPriority: "urgent",
      isFavourite: true,
    });
    expect(
      bookHoldings(
        work.catalogueStatus,
        copies.map((copy) => ({
          ...copy,
          location: {
            ...copy.location,
            type: z.enum(["physical", "digital"]).parse(copy.location.type),
          },
        })),
      ),
    ).toMatchObject({
      totalActive: 1,
      totalDeaccessioned: 1,
      lifecycle: { isPartiallyHeld: true, isInconsistent: false },
    });
  });
});
