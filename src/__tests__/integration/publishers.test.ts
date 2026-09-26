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
const url = process.env.DURTAL_PUBLISHER_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln319_test"
  )
    throw new Error("Publisher tests require disposable local sln319_test");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, p) => {
        if (!testDb) throw new Error("Local test DB required");
        return Reflect.get(testDb, p);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  CACHE_TAGS: { works: "works", editions: "editions", orders: "orders" },
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/s3/covers", () => ({ processAndUploadCover: vi.fn() }));
import {
  fulfilTargetWithCopy,
  getPublishers,
  savePublisher,
  getPublisherCatalogue,
  getEditionPublisherLinks,
  setEditionPublisherLinks,
  resetEditionPublisherLinks,
  createAcquisitionTarget,
  getAcquisitionTargets,
  getPublisherReview,
  cancelAcquisitionTarget,
  getOrderAcquisitionOptions,
} from "@/lib/actions/publishers";
import {
  createEdition,
  updateEdition,
  rematchEdition,
} from "@/lib/actions/editions";
import {
  createOrder,
  updateOrderStatus,
  updateOrder,
} from "@/lib/actions/orders";
import { getWorks, getWorkCount } from "@/lib/actions/works";
import { getWorksForTimeline } from "@/lib/actions/work-timeline";

describe.skipIf(!url)(
  "publisher identities and acquisition targets with PostgreSQL",
  () => {
    const db = testDb!;
    beforeAll(async () => {
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
    });
    afterAll(async () => {
      await client?.end();
    });
    beforeEach(async () => {
      await db.execute(
        sql`truncate works, publishing_houses, locations, publisher_specialties cascade`,
      );
      vi.clearAllMocks();
    });
    async function work(title = "A book") {
      return (
        await db
          .insert(schema.works)
          .values({ title, catalogueStatus: "accessioned", originalYear: 1944 })
          .returning()
      )[0];
    }
    async function publisher(name = "NYRB", country = "United States") {
      return savePublisher({ name, country });
    }
    async function edition(workId: string, name: string) {
      return createEdition({ workId, title: "Edition", publisher: name });
    }
    async function own(editionId: string) {
      const [location] = await db
        .insert(schema.locations)
        .values({ name: "Test shelf", type: "physical" })
        .returning();
      return (
        await db
          .insert(schema.instances)
          .values({ editionId, locationId: location.id })
          .returning()
      )[0];
    }
    it("matches exact names and approved aliases across imports without losing raw text", async () => {
      const p = await publisher();
      const w = await work();
      const e = await edition(w.id, "  nyrb  ");
      expect(
        (await getEditionPublisherLinks(e.id)).map((x) => x.publisher.id),
      ).toEqual([p.id]);
      await savePublisher(
        { name: "NYRB", aliases: ["New York Review Books"] },
        p.id,
      );
      await updateEdition(e.id, { publisher: "New York Review Books" });
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(p.id);
      expect(
        (
          await db
            .select()
            .from(schema.editions)
            .where(eq(schema.editions.id, e.id))
        )[0].publisher,
      ).toBe("New York Review Books");
    });
    it("does not conflate same-name publishers, including names that become ambiguous later", async () => {
      const us = await publisher("Wakefield Press");
      const w = await work();
      const e = await edition(w.id, "Wakefield Press");
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(
        us.id,
      );
      await publisher("Wakefield Press", "Australia");
      expect(await getEditionPublisherLinks(e.id)).toEqual([]);
      expect((await getPublisherReview()).total).toBe(1);
      await setEditionPublisherLinks(e.id, [us.id]);
      expect((await getPublisherReview()).total).toBe(0);
    });
    it("preserves explicit multi-publisher choices and explicit empty choices during metadata refresh", async () => {
      const a = await publisher("House A"),
        b = await publisher("House B");
      const w = await work();
      const e = await edition(w.id, "House A");
      await setEditionPublisherLinks(e.id, [a.id, b.id, a.id]);
      await updateEdition(e.id, { publisher: "Unknown imported spelling" });
      expect(
        (await getEditionPublisherLinks(e.id))
          .map((x) => x.publisher.id)
          .sort(),
      ).toEqual([a.id, b.id].sort());
      await setEditionPublisherLinks(e.id, []);
      await updateEdition(e.id, { publisher: "House A" });
      expect(await getEditionPublisherLinks(e.id)).toEqual([]);
      await resetEditionPublisherLinks(e.id);
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(a.id);
    });
    it("rolls back edition and publisher writes together when any foreign key is invalid", async () => {
      const w = await work();
      const bad = "00000000-0000-4000-8000-000000000001";
      await expect(
        createEdition({ workId: w.id, title: "Invalid", publisherIds: [bad] }),
      ).rejects.toThrow();
      expect(await db.select().from(schema.editions)).toHaveLength(0);
      const p = await publisher(),
        e = await edition(w.id, p.name);
      await setEditionPublisherLinks(e.id, [p.id]);
      await expect(
        updateEdition(e.id, { title: "Changed", publisherIds: [bad] }),
      ).rejects.toThrow();
      expect((await db.select().from(schema.editions))[0].title).toBe(
        "Edition",
      );
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(p.id);
      await expect(
        savePublisher(
          { name: "Changed", aliases: ["New Alias"], specialtyIds: [bad] },
          p.id,
        ),
      ).rejects.toThrow();
      expect((await db.select().from(schema.publishingHouses))[0].name).toBe(
        "NYRB",
      );
      expect(await db.select().from(schema.publisherAliases)).toHaveLength(0);
    });
    it("rolls imprints up to their house without conflating siblings or double-counting co-publications", async () => {
      const p = await publisher(),
        i = await savePublisher({
          name: "Classics",
          kind: "imprint",
          parentId: p.id,
        });
      const sibling = await savePublisher({
        name: "Kids",
        kind: "imprint",
        parentId: p.id,
      });
      const w = await work(),
        e = await edition(w.id, i.name);
      await setEditionPublisherLinks(e.id, [p.id, i.id]);
      await own(e.id);
      expect((await getPublisherCatalogue(p.id)).totals).toEqual({
        works: 1,
        editions: 1,
      });
      expect((await getPublisherCatalogue(i.id, "owned")).rows).toHaveLength(1);
      expect((await getPublisherCatalogue(sibling.id)).rows).toHaveLength(0);
      await expect(
        savePublisher(
          { name: i.name, kind: "imprint", parentId: sibling.id },
          i.id,
        ),
      ).rejects.toThrow();
      await expect(
        db
          .delete(schema.publishingHouses)
          .where(eq(schema.publishingHouses.id, p.id)),
      ).rejects.toThrow();
    });
    it("owning Penguin leaves the NYRB edition wanted; exact-edition ownership and filters agree", async () => {
      const p = await publisher(),
        penguin = await publisher("Penguin"),
        w = await work();
      const e = await edition(w.id, p.name),
        other = await edition(w.id, penguin.name);
      await own(other.id);
      const t = await createAcquisitionTarget({
        workId: w.id,
        publisherId: p.id,
      });
      expect((await getPublisherCatalogue(p.id, "owned")).rows).toHaveLength(0);
      expect(
        (await getPublisherCatalogue(p.id, "wanted")).rows.map(
          (r) => r.edition.id,
        ),
      ).toEqual([e.id]);
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("wanted");
      expect((await getOrderAcquisitionOptions(w.id)).matches).toEqual([
        { targetId: t.id, editionId: e.id },
      ]);
      const filters = { publisherIds: [p.id] };
      expect((await getWorks({ filters })).map((w) => w.id)).toEqual([w.id]);
      expect(await getWorkCount(undefined, filters)).toBe(1);
      expect((await getWorksForTimeline({ filters })).map((w) => w.id)).toEqual(
        [w.id],
      );
    });
    it("rejects wrong editions on create, update, and delivery; received and returned statuses derive correctly", async () => {
      const p = await publisher(),
        other = await publisher("Penguin"),
        w = await work();
      const e = await edition(w.id, p.name),
        wrong = await edition(w.id, other.name);
      const t = await createAcquisitionTarget({
        workId: w.id,
        publisherId: p.id,
      });
      const input = {
        workId: w.id,
        acquisitionTargetId: t.id,
        orderDate: "2026-09-25",
        acquisitionMethod: "online_order" as const,
      };
      await expect(
        createOrder({ ...input, editionId: wrong.id }),
      ).rejects.toThrow();
      const o = await createOrder(input);
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("on_order");
      await expect(updateOrderStatus(o.id, "delivered")).rejects.toThrow();
      await expect(
        updateOrder(o.id, { editionId: wrong.id }),
      ).rejects.toThrow();
      await expect(cancelAcquisitionTarget(t.id)).rejects.toThrow();
      await updateOrder(o.id, { editionId: e.id });
      await updateOrderStatus(o.id, "delivered");
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("received");
      expect((await getPublisherCatalogue(p.id, "owned")).rows).toHaveLength(0); // receipt is not a copy record
      await updateOrderStatus(o.id, "returned");
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("wanted");
      await cancelAcquisitionTarget(t.id);
      expect(await getAcquisitionTargets(w.id)).toHaveLength(0);
    });
    it("validates target scope, uniqueness and edition/copy consistency at the database boundary", async () => {
      const p = await publisher(),
        w = await work(),
        w2 = await work("Other");
      const e = await edition(w.id, p.name),
        e2 = await edition(w2.id, p.name);
      await expect(
        createAcquisitionTarget({ workId: w.id, editionId: e2.id }),
      ).rejects.toThrow();
      await expect(
        createAcquisitionTarget({
          workId: w.id,
          editionId: e.id,
          publisherId: p.id,
        }),
      ).rejects.toThrow();
      const t = await createAcquisitionTarget({
        workId: w.id,
        editionId: e.id,
      });
      await expect(
        createAcquisitionTarget({ workId: w.id, editionId: e.id }),
      ).rejects.toThrow("already exists");
      const wrongCopy = await own(e2.id);
      await expect(
        createOrder({
          workId: w.id,
          editionId: e.id,
          instanceId: wrongCopy.id,
          acquisitionTargetId: t.id,
          acquisitionMethod: "gift",
          status: "received",
          orderDate: "2026-09-25",
        }),
      ).rejects.toThrow();
      await expect(
        db
          .update(schema.editions)
          .set({ workId: w2.id })
          .where(eq(schema.editions.id, e.id)),
      ).rejects.toThrow();
    });
    it("does not show disposed copies as owned and never fulfils targets from unrelated orders", async () => {
      const p = await publisher(),
        w = await work(),
        e = await edition(w.id, p.name),
        copy = await own(e.id);
      await db
        .update(schema.instances)
        .set({ status: "deaccessioned" })
        .where(eq(schema.instances.id, copy.id));
      await createAcquisitionTarget({ workId: w.id, editionId: e.id });
      await createOrder({
        workId: w.id,
        editionId: e.id,
        acquisitionMethod: "gift",
        status: "received",
        orderDate: "2026-09-25",
      });
      expect((await getPublisherCatalogue(p.id, "owned")).rows).toHaveLength(0);
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("wanted");
    });
    it("directory counts are scoped to each publisher, including zero-edition houses", async () => {
      const p = await publisher(),
        other = await publisher("Uncollected"),
        w = await work();
      await edition(w.id, p.name);
      const counts = (await getPublishers()).rows;
      expect(counts.find((r) => r.publisher.id === p.id)?.editionCount).toBe(1);
      expect(
        counts.find((r) => r.publisher.id === other.id)?.editionCount,
      ).toBe(0);
    });
    it("an owned book can be hunted from a publisher without inventing an edition", async () => {
      const p = await publisher(),
        penguin = await publisher("Penguin"),
        w = await work();
      await own((await edition(w.id, penguin.name)).id);
      await createAcquisitionTarget({ workId: w.id, publisherId: p.id });
      const filters = { publisherIds: [p.id], catalogueStatus: ["wanted"] };
      expect(await getWorkCount(undefined, filters)).toBe(1);
      expect((await getWorks({ filters })).map((w) => w.id)).toEqual([w.id]);
      expect((await getWorksForTimeline({ filters })).map((w) => w.id)).toEqual(
        [w.id],
      );
      expect((await getPublisherCatalogue(p.id)).pendingTargets).toHaveLength(
        1,
      );
      expect((await getPublisherCatalogue(p.id)).rows).toHaveLength(0);
      const o = await createOrder({
        workId: w.id,
        acquisitionTargetId: (await getAcquisitionTargets(w.id))[0].target.id,
        acquisitionMethod: "online_order",
        orderDate: "2026-09-25",
      });
      expect((await db.select().from(schema.works))[0].catalogueStatus).toBe(
        "accessioned",
      );
      expect(
        await getWorkCount(undefined, {
          publisherIds: [p.id],
          catalogueStatus: ["on_order"],
        }),
      ).toBe(1);
      await updateOrderStatus(o.id, "cancelled");
      expect((await db.select().from(schema.works))[0].catalogueStatus).toBe(
        "accessioned",
      );
    });
    it("any-edition targets and existing wanted books remain discoverable by publisher", async () => {
      const p = await publisher(),
        w = await work();
      const e = await edition(w.id, p.name);
      await db
        .update(schema.works)
        .set({ catalogueStatus: "wanted" })
        .where(eq(schema.works.id, w.id));
      expect(
        (await getPublisherCatalogue(p.id, "wanted")).rows.map(
          (r) => r.edition.id,
        ),
      ).toEqual([e.id]);
      await db
        .update(schema.works)
        .set({ catalogueStatus: "tracked" })
        .where(eq(schema.works.id, w.id));
      await createAcquisitionTarget({ workId: w.id });
      expect(
        (await getPublisherCatalogue(p.id, "wanted")).rows.map(
          (r) => r.edition.id,
        ),
      ).toEqual([e.id]);
    });
    it("fulfils an acquisition target only with an explicitly chosen matching copy; disposition reopens it", async () => {
      const p = await publisher(),
        other = await publisher("Penguin"),
        w = await work();
      const e = await edition(w.id, p.name),
        wrong = await edition(w.id, other.name),
        copy = await own(e.id),
        wrongCopy = await own(wrong.id);
      const t = await createAcquisitionTarget({
        workId: w.id,
        editionId: e.id,
      });
      await db
        .update(schema.works)
        .set({ catalogueStatus: "wanted" })
        .where(eq(schema.works.id, w.id));
      await expect(fulfilTargetWithCopy(t.id, wrongCopy.id)).rejects.toThrow();
      expect(
        (
          await db.select().from(schema.works).where(eq(schema.works.id, w.id))
        )[0].catalogueStatus,
      ).toBe("wanted");
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("wanted");
      await fulfilTargetWithCopy(t.id, copy.id);
      expect(
        (
          await db.select().from(schema.works).where(eq(schema.works.id, w.id))
        )[0].catalogueStatus,
      ).toBe("accessioned");
      expect(
        (
          await db
            .select()
            .from(schema.workStatusHistory)
            .where(eq(schema.workStatusHistory.workId, w.id))
        )[0],
      ).toMatchObject({ fromStatus: "wanted", toStatus: "accessioned" });
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("received");
      await expect(
        db
          .update(schema.instances)
          .set({ editionId: wrong.id })
          .where(eq(schema.instances.id, copy.id)),
      ).rejects.toThrow();
      await db
        .update(schema.instances)
        .set({ status: "deaccessioned" })
        .where(eq(schema.instances.id, copy.id));
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("wanted");
    });
    it("provider refresh keeps manual publisher identities and honours metadata locks", async () => {
      const p = await publisher(),
        w = await work(),
        e = await edition(w.id, p.name);
      await setEditionPublisherLinks(e.id, [p.id]);
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            volumeInfo: {
              title: "Refreshed title",
              publisher: "Unrecognised spelling",
            },
          }),
          { status: 200 },
        ),
      );
      try {
        await rematchEdition(e.id, "google_books", "synthetic-volume");
        expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(
          p.id,
        );
        await updateEdition(e.id, { metadataLocked: true });
        fetchMock.mockClear();
        await expect(
          rematchEdition(e.id, "google_books", "synthetic-volume"),
        ).rejects.toThrow("Unlock");
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        fetchMock.mockRestore();
      }
    });
    it("concurrent duplicate acquisition requests create exactly one target", async () => {
      const p = await publisher(),
        w = await work();
      const outcomes = await Promise.allSettled([
        createAcquisitionTarget({ workId: w.id, publisherId: p.id }),
        createAcquisitionTarget({ workId: w.id, publisherId: p.id }),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await getAcquisitionTargets(w.id)).toHaveLength(1);
    });

    it("partial publisher edits preserve language, metadata lock and collector flags", async () => {
      const w = await work();
      const e = await createEdition({
        workId: w.id,
        title: "Preserved edition",
        publisher: "Unknown",
        language: "es",
        metadataLocked: true,
        isTranslated: true,
        isFirstEdition: true,
        isLimitedEdition: true,
      });
      await updateEdition(e.id, { publisher: "NYRB" });
      const [updated] = await db
        .select()
        .from(schema.editions)
        .where(eq(schema.editions.id, e.id));
      expect(updated).toMatchObject({
        language: "es",
        metadataLocked: true,
        isTranslated: true,
        isFirstEdition: true,
        isLimitedEdition: true,
        publisher: "NYRB",
      });
    });
    it("paginates publisher catalogues and review queues with shared page sizes and stable boundaries", async () => {
      const p = await publisher();
      const books = await db.insert(schema.works).values(Array.from({ length: 49 }, () => ({ title: "Same title" }))).returning();
      const editions = await db.insert(schema.editions).values(books.map((w) => ({ workId: w.id, title: "Edition", publisher: "Unresolved fixture house" }))).returning();
      await db.insert(schema.editionPublishers).values(editions.map((e) => ({ editionId: e.id, publisherId: p.id })));
      const first = await getPublisherCatalogue(p.id, "all", 1, 48);
      const second = await getPublisherCatalogue(p.id, "all", 2, 48);
      expect(first.totals.works).toBe(49);
      expect(first.rows).toHaveLength(48);
      expect(second.rows).toHaveLength(1);
      expect(new Set([...first.rows, ...second.rows].map((r) => r.work.id)).size).toBe(49);
      expect((await getPublisherCatalogue(p.id, "all", NaN, 24)).rows).toHaveLength(24);
      const reviewFirst = await getPublisherReview(1, 48);
      const reviewSecond = await getPublisherReview(2, 48);
      expect(reviewFirst.total).toBe(49);
      expect(reviewFirst.rows).toHaveLength(48);
      expect(reviewSecond.rows).toHaveLength(1);
      expect(new Set([...reviewFirst.rows, ...reviewSecond.rows].map((r) => r.edition.id)).size).toBe(49);
    });
  },
);
