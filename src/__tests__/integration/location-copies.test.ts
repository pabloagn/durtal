import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

/**
 * Book copies and their places: the live count of what each location holds
 * (SLN-575, every kind of item) and a sub-location that must belong to its
 * copy's location (SLN-574).
 */
// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_LOCATION_COPIES_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln575_location_copies");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln575_location_copies"
  )
    throw new Error("Location copy tests require disposable local sln575_location_copies");
}
const client = url ? postgres(url, { prepare: false, max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
// The cached locations stay warm for the whole file: counts must not depend on them
const cache = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
vi.mock("@/lib/cache", () => ({
  cached: (fn: () => Promise<unknown>, keyParts: string[]) => async () => {
    const key = keyParts.join("/");
    if (!cache.store.has(key)) cache.store.set(key, await fn());
    return cache.store.get(key);
  },
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, key) => String(key) }),
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { deleteLocation, getLocationItemCounts, getLocations } from "@/lib/actions/locations";
vi.mock("@/lib/s3/client", async () => (await import("@/__tests__/helpers/memory-bucket")).memoryS3Client());
import { deleteWork, getWorkDeleteSummary } from "@/lib/actions/works";
import { copyDeleteCascadeMessage, workDeleteCascadeMessage } from "@/lib/catalogue/delete-cascade";
import { createInstance, deleteInstance, updateInstance, getCopyDeleteSummary } from "@/lib/actions/instances";

describe.skipIf(!url)("book copies and their locations with PostgreSQL", () => {
  const db = testDb!;
  const c = client!;
  let editionId: string, home: string, office: string, homeShelf: string, officeShelf: string;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln575_location_copies");
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    cache.store.clear();
    await resetDisposableDatabase(url!, "sln575_location_copies", { emptyLocations: true });
    const [work] = await db.insert(schema.works).values({ title: "Là-bas", slug: "la-bas" }).returning();
    const [edition] = await db.insert(schema.editions).values({ workId: work.id, title: "Là-bas" }).returning();
    editionId = edition.id;
    [{ id: home }, { id: office }] = await db
      .insert(schema.locations)
      .values([
        { name: "Home", type: "physical", sortOrder: 0 },
        { name: "Office", type: "physical", sortOrder: 1 },
      ])
      .returning();
    [{ id: homeShelf }, { id: officeShelf }] = await db
      .insert(schema.subLocations)
      .values([
        { locationId: home, name: "Study shelf" },
        { locationId: office, name: "Desk" },
      ])
      .returning();
  }, 30000);

  // Book copies only, as the copy tests below write nothing else
  const counts = async () =>
    Object.fromEntries([...(await getLocationItemCounts())].map(([id, items]) => [id, items.copies]));
  const place = async (id: string) => {
    const [row] = await db
      .select({ locationId: schema.instances.locationId, subLocationId: schema.instances.subLocationId })
      .from(schema.instances)
      .where(eq(schema.instances.id, id));
    return row;
  };

  describe("copy counts (SLN-575)", () => {
    it("follow every add, move and delete while the cached locations stay warm", async () => {
      expect((await getLocations()).map((l) => l.name)).toEqual(["Home", "Office"]);
      expect(await counts()).toEqual({});

      const first = await createInstance({ editionId, locationId: home });
      const second = await createInstance({ editionId, locationId: home });
      expect(await counts()).toEqual({ [home]: 2 });

      await updateInstance(second.id, { locationId: office });
      expect(await counts()).toEqual({ [home]: 1, [office]: 1 });

      await deleteInstance(first.id);
      expect(await counts()).toEqual({ [office]: 1 });

      // A cascade from the edition, with no copy action at all
      await db.delete(schema.editions).where(eq(schema.editions.id, editionId));
      expect(await counts()).toEqual({});
      // The cached list was read once and never refreshed
      expect(cache.store.size).toBe(1);
    });

    it("leave a failed write out of the count", async () => {
      await createInstance({ editionId, locationId: home });
      await expect(createInstance({ editionId, locationId: home, subLocationId: officeShelf })).rejects.toThrow();
      expect(await counts()).toEqual({ [home]: 1 });
    });
  });

  describe("every kind of item", () => {
    const sqlValue = async (query: string, params: unknown[] = []) =>
      (await client!.unsafe(query, params as never[]))[0]?.id as string;
    async function holdings(at: string) {
      const kindWork = (kind: string, title: string) =>
        sqlValue(`insert into works(kind, title, slug, original_language) values ($1, $2, $3, null) returning id`, [
          kind,
          title,
          `${kind}-${title.toLowerCase().replace(/\W+/g, "-")}`,
        ]);
      const film = await kindWork("film", "Alien");
      await client!.unsafe(`insert into film_details(work_id) values ($1)`, [film]);
      for (const label of ["Blu-ray", "DVD"])
        await client!.unsafe(
          `insert into film_holdings(work_id, medium, format_label, status, location_id) values ($1, 'physical', $2, 'held', $3)`,
          [film, label, at],
        );
      const painting = await kindWork("painting", "Nocturne");
      await client!.unsafe(`insert into painting_details(work_id) values ($1)`, [painting]);
      await client!.unsafe(
        `insert into art_objects(work_id, kind, ownership, holding_status, location_id) values ($1, 'original', 'personal', 'held', $2)`,
        [painting, at],
      );
      const perfume = await kindWork("perfume", "Mitsouko");
      await client!.unsafe(`insert into perfume_details(work_id) values ($1)`, [perfume]);
      const variant = await sqlValue(
        `insert into perfume_variants(work_id, concentration) values ($1, 'eau_de_parfum') returning id`,
        [perfume],
      );
      await client!.unsafe(
        `insert into perfume_bottles(variant_id, container, capacity_value, volume_unit, location_id) values ($1, 'bottle', 50, 'ml', $2)`,
        [variant, at],
      );
    }

    it("counts film copies, paintings and perfume bottles beside book copies, live", async () => {
      expect((await getLocations()).map((l) => l.name)).toEqual(["Home", "Office"]);
      await createInstance({ editionId, locationId: home });
      await holdings(office);
      expect(Object.fromEntries(await getLocationItemCounts())).toEqual({
        [home]: { copies: 1, films: 0, paintings: 0, perfumes: 0 },
        [office]: { copies: 0, films: 2, paintings: 1, perfumes: 1 },
      });
      // A bottle moved home shows on the next read, with the cached list still warm
      await client!.unsafe(`update perfume_bottles set location_id = $1`, [home]);
      expect((await getLocationItemCounts()).get(home)).toEqual({ copies: 1, films: 0, paintings: 0, perfumes: 1 });
      expect(cache.store.size).toBe(1);
    });

    it("a location that holds anything, book copies included, cannot be deleted, and says what to move (SLN-1060)", async () => {
      await holdings(office);
      await createInstance({ editionId, locationId: office });
      await expect(deleteLocation(office)).rejects.toThrow(
        "Office holds 1 book copy, 2 film copies, 1 painting and 1 perfume bottle. Move them to another location first.",
      );
      expect((await getLocationItemCounts()).get(office)).toEqual({ copies: 1, films: 2, paintings: 1, perfumes: 1 });

      const copy = await createInstance({ editionId, locationId: home });
      await expect(deleteLocation(home)).rejects.toThrow("Home holds 1 book copy. Move it to another location first.");
      expect(await db.select().from(schema.instances)).toHaveLength(2);

      // Once empty, it goes
      await client!.unsafe(`delete from instances where id = $1`, [copy.id]);
      await deleteLocation(home);
      expect((await db.select().from(schema.locations)).map((l) => l.id)).toEqual([office]);
      expect(await db.select().from(schema.instances)).toHaveLength(1);
    });

    it("the refusal crosses to the page as its reason", async () => {
      const { deleteLocation: deleteFromPage } = await import("@/lib/actions/catalogue-ui");
      await createInstance({ editionId, locationId: home });
      await expect(deleteFromPage(home)).resolves.toEqual({
        ok: false,
        error: "Home holds 1 book copy. Move it to another location first.",
      });
    });
  });

  describe("sub-locations (SLN-574)", () => {
    it("refuses a new copy on a sub-location of another location, and keeps a fitting one", async () => {
      await expect(
        createInstance({ editionId, locationId: home, subLocationId: officeShelf }),
      ).rejects.toThrow("The sub-location belongs to another location");
      expect(await db.select().from(schema.instances)).toEqual([]);

      const copy = await createInstance({ editionId, locationId: office, subLocationId: officeShelf });
      expect(await place(copy.id)).toEqual({ locationId: office, subLocationId: officeShelf });
      const loose = await createInstance({ editionId, locationId: home });
      expect(await place(loose.id)).toEqual({ locationId: home, subLocationId: null });
    });

    it("refuses an edit that names a sub-location of another location, and changes nothing", async () => {
      const copy = await createInstance({ editionId, locationId: office, subLocationId: officeShelf });
      await expect(updateInstance(copy.id, { locationId: home, subLocationId: officeShelf })).rejects.toThrow(
        "The sub-location belongs to another location",
      );
      await expect(updateInstance(copy.id, { subLocationId: homeShelf })).rejects.toThrow(
        "The sub-location belongs to another location",
      );
      expect(await place(copy.id)).toEqual({ locationId: office, subLocationId: officeShelf });
    });

    it("takes a moved copy off its old sub-location when the move names none", async () => {
      const copy = await createInstance({ editionId, locationId: office, subLocationId: officeShelf });
      await updateInstance(copy.id, { locationId: home });
      expect(await place(copy.id)).toEqual({ locationId: home, subLocationId: null });

      await updateInstance(copy.id, { locationId: home, subLocationId: homeShelf });
      expect(await place(copy.id)).toEqual({ locationId: home, subLocationId: homeShelf });
      // Staying put, or changing something else, keeps it
      await updateInstance(copy.id, { locationId: home, condition: "fine" });
      await updateInstance(copy.id, { status: "lent_out" });
      expect(await place(copy.id)).toEqual({ locationId: home, subLocationId: homeShelf });
      // And clearing it on purpose clears it
      await updateInstance(copy.id, { subLocationId: null });
      expect(await place(copy.id)).toEqual({ locationId: home, subLocationId: null });
    });
  });

  describe("loans (SLN-1125)", () => {
    const history = (id: string) =>
      db
        .select({ from: schema.instanceStatusHistory.fromStatus, to: schema.instanceStatusHistory.toStatus, notes: schema.instanceStatusHistory.notes })
        .from(schema.instanceStatusHistory)
        .where(eq(schema.instanceStatusHistory.instanceId, id))
        .orderBy(schema.instanceStatusHistory.changedAt);
    const loan = async (id: string) => {
      const [row] = await db
        .select({ status: schema.instances.status, lentTo: schema.instances.lentTo, lentDate: schema.instances.lentDate })
        .from(schema.instances)
        .where(eq(schema.instances.id, id));
      return row;
    };

    it("lend, return and deaccession leave three history rows, the borrower kept", async () => {
      const copy = await createInstance({ editionId, locationId: home });
      await updateInstance(copy.id, { status: "lent_out", lentTo: "Léon Bloy", lentDate: "2026-10-18" });
      expect(await loan(copy.id)).toEqual({ status: "lent_out", lentTo: "Léon Bloy", lentDate: "2026-10-18" });
      // An edit that keeps the status writes no row
      await updateInstance(copy.id, { status: "lent_out", lentTo: "Léon Bloy" });
      await updateInstance(copy.id, { status: "available" });
      expect(await loan(copy.id)).toEqual({ status: "available", lentTo: null, lentDate: null });
      await updateInstance(copy.id, { status: "deaccessioned", dispositionDate: "2026-11-02" });
      expect(await history(copy.id)).toEqual([
        { from: "available", to: "lent_out", notes: "Lent to Léon Bloy from 2026-10-18" },
        { from: "lent_out", to: "available", notes: "Lent to Léon Bloy from 2026-10-18" },
        { from: "available", to: "deaccessioned", notes: null },
      ]);
    });

    it("notes a loan with no name or date, and keeps an edit without a status out of the history", async () => {
      const copy = await createInstance({ editionId, locationId: home });
      await updateInstance(copy.id, { notes: "Foxed" });
      await updateInstance(copy.id, { status: "lent_out", lentTo: "  ", lentDate: null });
      await updateInstance(copy.id, { status: "missing" });
      expect(await loan(copy.id)).toEqual({ status: "missing", lentTo: null, lentDate: null });
      expect(await history(copy.id)).toEqual([
        { from: "available", to: "lent_out", notes: "Lent" },
        { from: "lent_out", to: "missing", notes: "Lent" },
      ]);
    });
  });
  async function deletionFixture() {
    const [edition] = await c`select work_id from editions where id=${editionId}`;
    const workId = edition.work_id as string;
    const copy = await createInstance({ editionId, locationId: home });
    const [history] = await c`insert into instance_status_history(instance_id,to_status) values (${copy.id},'available') returning id`;
    const [target] = await c`insert into acquisition_targets(work_id,edition_id) values (${workId},${editionId}) returning id`;
    await c`insert into acquisition_target_copies(target_id,instance_id) values (${target.id},${copy.id})`;
    const [order] = await c`insert into orders(work_id,edition_id,instance_id,acquisition_target_id,acquisition_method,status,order_date)
      values (${workId},${editionId},${copy.id},${target.id},'online_order','returned','2026-10-01') returning id`;
    const [orderHistory] = await c`insert into order_status_history(order_id,to_status) values (${order.id},'returned') returning id`;
    const [reading] = await c`insert into readings(work_id,edition_id,instance_id,started_precision) values (${workId},${editionId},${copy.id},'unknown') returning id`;
    const [session] = await c`insert into reading_sessions(reading_id,edition_id,format,read_on,time_zone,start_page,end_page)
      values (${reading.id},${editionId},'print','2026-10-01','Europe/Amsterdam',0,5) returning id`;
    const notes = await c`insert into reading_notes(work_id,reading_id,edition_id,kind,body) values
      (${workId},${reading.id},${editionId},'quote','A kept passage'),(${workId},${reading.id},${editionId},'note','A thought') returning id`;
    const [publisher] = await c`insert into publishing_houses(name,slug) values ('Deletion test publisher','deletion-test-publisher') returning id`;
    await c`insert into edition_publishers(edition_id,publisher_id) values (${editionId},${publisher.id})`;
    const [image] = await c`insert into media(work_id,type,s3_key) values (${workId},'gallery','qa/delete-summary.webp') returning id`;
    const [ebook] = await c`insert into ebooks(title,import_source,instance_id,match_state) values ('Digital text','folder',${copy.id},'linked') returning id`;
    const hash = 'd'.repeat(64);
    const [file] = await c`insert into ebook_files(ebook_id,sha256,format,size_bytes,content_type,s3_key,status)
      values (${ebook.id},${hash},'epub',1000,'application/epub+zip','qa/delete-summary.epub','stored') returning *`;
    const locator = { v: 1, fileHash: hash, href: 'chapter.xhtml', sectionIndex: 0, progression: 0.1, totalProgression: 0.1 };
    const [position] = await c`insert into ebook_positions(ebook_id,file_id,device_id,device_label,locator,progression,furthest_progression,client_updated_at)
      values (${ebook.id},${file.id},'delete-test','Mac',${JSON.stringify(locator)}::text::jsonb,0.1,0.1,now()) returning *`;
    const [annotation] = await c`insert into ebook_annotations(ebook_id,file_id,kind,locator,progression,client_updated_at)
      values (${ebook.id},${file.id},'bookmark',${JSON.stringify(locator)}::text::jsonb,0.1,now()) returning *`;
    const [unrelated] = await c`insert into works(title,slug) values ('Unaffected book','unaffected-book') returning *`;
    return { workId, copy, history, target, order, orderHistory, reading, session, notes, publisher, image, ebook, file, position, annotation, unrelated };
  }
  async function expectDigitalKept(f: Awaited<ReturnType<typeof deletionFixture>>) {
    expect(await c`select instance_id,match_state from ebooks where id=${f.ebook.id}`).toEqual([{ instance_id: null, match_state: 'pending' }]);
    expect(await c`select * from ebook_files where id=${f.file.id}`).toEqual([f.file]);
    expect(await c`select * from ebook_positions where id=${f.position.id}`).toEqual([f.position]);
    expect(await c`select * from ebook_annotations where id=${f.annotation.id}`).toEqual([f.annotation]);
    expect(await c`select * from works where id=${f.unrelated.id}`).toEqual([f.unrelated]);
    expect(await c`select id from publishing_houses where id=${f.publisher.id}`).toHaveLength(1);
  }
  it("deletes exactly the copy dependents counted by its dialog and retains its reading and digital history", async () => {
    const f = await deletionFixture();
    const summary = await getCopyDeleteSummary(f.copy.id);
    expect(summary).toEqual({ history: 1, targets: 1, readings: 1, orders: 1, ebook: true });
    expect(copyDeleteCascadeMessage(summary)).toContain('1 reading and 1 order stay with the book, without this copy');
    await deleteInstance(f.copy.id);
    expect(await c`select id from instances where id=${f.copy.id}`).toEqual([]);
    expect(await c`select id from instance_status_history where instance_id=${f.copy.id}`).toEqual([]);
    expect(await c`select target_id from acquisition_target_copies where instance_id=${f.copy.id}`).toEqual([]);
    expect(await c`select id from acquisition_targets where id=${f.target.id}`).toHaveLength(1);
    expect(await c`select instance_id from readings where id=${f.reading.id}`).toEqual([{ instance_id: null }]);
    expect(await c`select instance_id from orders where id=${f.order.id}`).toEqual([{ instance_id: null }]);
    expect(await c`select id from reading_sessions where id=${f.session.id}`).toHaveLength(1);
    expect(await c`select id from reading_notes where reading_id=${f.reading.id}`).toHaveLength(2);
    expect(await c`select publisher_id from edition_publishers where edition_id=${editionId}`).toEqual([{ publisher_id: f.publisher.id }]);
    await expectDigitalKept(f);
  });
  it("deletes exactly the book dependents counted by its dialog but keeps digital files, positions and annotations", async () => {
    const f = await deletionFixture();
    const summary = await getWorkDeleteSummary([f.workId]);
    expect(summary).toEqual({ editions: 1, copies: 1, readings: 1, sessions: 1, quotes: 1, notes: 1, orders: 1, targets: 1, images: 1, ebooks: 1, refusal: null });
    expect(workDeleteCascadeMessage(summary)).toContain('files, reading positions and annotations are kept');
    await deleteWork(f.workId);
    for (const [table, id] of [ ['works',f.workId], ['editions',editionId], ['instances',f.copy.id], ['instance_status_history',f.history.id],
      ['readings',f.reading.id], ['reading_sessions',f.session.id], ...f.notes.map(note => ['reading_notes',note.id]),
      ['orders',f.order.id], ['order_status_history',f.orderHistory.id], ['acquisition_targets',f.target.id], ['media',f.image.id] ]) {
      expect(await c.unsafe(`select id from ${table} where id=$1`, [id])).toEqual([]);
    }
    expect(await c`select target_id from acquisition_target_copies where target_id=${f.target.id}`).toEqual([]);
    expect(await c`select publisher_id from edition_publishers where edition_id=${editionId}`).toEqual([]);
    await expectDigitalKept(f);
  });

});
