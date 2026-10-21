import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
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
import { asc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { todayLocal } from "@/lib/utils/date";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_ORDER_STATUS_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln280_test");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln280_test"
  ) {
    throw new Error(
      "Order status sync tests require a disposable local sln280_test database",
    );
  }
}
const client = url ? postgres(url, { prepare: false, max: 1, onnotice: () => {} }) : null;
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
const { recordActivity } = vi.hoisted(() => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity }));
import {
  createOrder,
  createOrderGroup,
  getOrder,
  getProvenanceStats,
  deleteOrder,
  searchWorksForOrder,
  updateOrder,
  updateOrderStatus,
} from "@/lib/actions/orders";
import { deleteWork, getWorkDeleteSummary } from "@/lib/actions/works";
import { deleteWork as deleteWorkForScreen } from "@/lib/actions/catalogue-ui";

type Status = typeof schema.works.$inferSelect.catalogueStatus;

describe.skipIf(!url)("order status sync with PostgreSQL (SLN-280)", () => {
  const db = testDb!;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln280_test");
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln280_test");
    recordActivity.mockClear();
  }, 30000);

  /** A book with one edition */
  async function work(catalogueStatus: Status) {
    const [row] = await db
      .insert(schema.works)
      .values({ title: "Against Nature", catalogueStatus })
      .returning();
    await edition(row.id);
    return row.id;
  }
  async function edition(workId: string) {
    const [row] = await db
      .insert(schema.editions)
      .values({ workId, title: "Against Nature" })
      .returning();
    return row.id;
  }
  async function place(name = "Amsterdam", type: "physical" | "digital" = "physical") {
    const [row] = await db.insert(schema.locations).values({ name, type }).returning();
    return row.id;
  }
  function order(workId: string, destinationLocationId: string | null = null) {
    return createOrder({
      workId,
      acquisitionMethod: "online_order",
      orderDate: "2026-09-25",
      destinationLocationId,
    });
  }
  function copies() {
    return db.select().from(schema.instances);
  }
  async function status(workId: string) {
    const [row] = await db
      .select({ s: schema.works.catalogueStatus })
      .from(schema.works)
      .where(eq(schema.works.id, workId));
    return row.s;
  }
  async function history(workId: string) {
    return (
      await db
        .select({
          from: schema.workStatusHistory.fromStatus,
          to: schema.workStatusHistory.toStatus,
        })
        .from(schema.workStatusHistory)
        .where(eq(schema.workStatusHistory.workId, workId))
        .orderBy(asc(schema.workStatusHistory.changedAt))
    ).map((h) => `${h.from}→${h.to}`);
  }

  it("finds a book to order by title, accents and case ignored (SLN-881)", async () => {
    await db.insert(schema.works).values([{ title: "À rebours" }, { title: "Là-bas" }]);
    expect((await searchWorksForOrder("A REBOURS")).map((w) => w.title)).toEqual(["À rebours"]);
    expect((await searchWorksForOrder("rebours")).map((w) => w.title)).toEqual(["À rebours"]);
    expect((await searchWorksForOrder("la bas")).map((w) => w.title)).toEqual(["Là-bas"]);
  });

  it("ranks exact titles before typos and finds a title by a misspelling or its author", async () => {
    const [author] = await db.insert(schema.authors).values({ name: "Alberto Moravia", slug: "moravia" }).returning();
    const [book] = await db.insert(schema.works).values({ title: "Agostino", slug: "agostino" }).returning();
    await db.insert(schema.workAuthors).values({ workId: book.id, authorId: author.id });
    await db.insert(schema.works).values([{ title: "Agostno", slug: "exact-agostno" }, { title: "Unrelated", slug: "unrelated" }]);
    expect((await searchWorksForOrder("Agostno")).map((w) => w.title).slice(0, 2)).toEqual(["Agostno", "Agostino"]);
    expect((await searchWorksForOrder("moravya agostino")).map((w) => w.title)).toContain("Agostino");
    expect(await searchWorksForOrder("   ")).toEqual([]);
    expect(await searchWorksForOrder("💡")).toEqual([]);
  });

  it("keeps shipping once for a multi-book order and updates its shared fields together", async () => {
    const a = await work("wanted"), b = await work("wanted");
    const purchase = await createOrderGroup({ acquisitionMethod: "online_order", orderDate: "2026-10-21",
      currency: "EUR", shippingCost: "5.00", items: [{ workId: a, price: "10.00" }, { workId: b, price: "20.00" }] });
    expect(await getProvenanceStats()).toMatchObject({ orderCount: 1, activeOrders: 1, spentByCurrency: [{ currency: "EUR", total: "35.00" }] });
    const [shop] = await db.insert(schema.venues).values({ name: "Test shop", slug: "test-shop", type: "bookshop" }).returning();
    await updateOrder(purchase.orderIds[0], { venueId: shop.id, shippingCost: "7.00", price: "12.00", totalCost: "19.00" });
    const rows = await db.select().from(schema.orders);
    expect(rows.map((row) => row.venueId)).toEqual([shop.id, shop.id]);
    expect(rows.every((row) => row.shippingCost === null && row.totalCost === row.price)).toBe(true);
    expect((await getProvenanceStats()).spentByCurrency).toEqual([{ currency: "EUR", total: "39.00" }]);
    expect((await getOrder(purchase.orderIds[0]))?.group?.items).toHaveLength(2);
    await expect(db.update(schema.orders).set({ venueId: null }).where(eq(schema.orders.id, purchase.orderIds[1]))).rejects.toThrow();
  });

  it("creates each received book copy in the same purchase, with only its own item price", async () => {
    const a = await work("wanted"), b = await work("wanted"), destination = await place();
    const purchase = await createOrderGroup({ acquisitionMethod: "in_store_purchase", status: "purchased", orderDate: "2026-10-21",
      currency: "EUR", shippingCost: "3.00", destinationLocationId: destination,
      items: [{ workId: a, price: "10.00" }, { workId: b, price: "20.00" }] });
    expect(purchase.orderIds).toHaveLength(2);
    expect((await copies()).map((copy) => copy.acquisitionPrice).sort()).toEqual(["10.00", "20.00"]);
    expect(await status(a)).toBe("accessioned");
    expect(await status(b)).toBe("accessioned");
  });

  it("does not leave half an order when one member is invalid", async () => {
    const a = await work("wanted");
    await expect(createOrderGroup({ acquisitionMethod: "online_order", orderDate: "2026-10-21",
      items: [{ workId: a }, { workId: "00000000-0000-4000-8000-000000000099" }] })).rejects.toThrow();
    expect(await db.select().from(schema.orderGroups)).toHaveLength(0);
    expect(await db.select().from(schema.orders)).toHaveLength(0);
  });

  it("follows a wanted work through order and delivery", async () => {
    const id = await work("wanted");
    const o = await order(id, await place());
    expect(await status(id)).toBe("on_order");
    await updateOrderStatus(o.id, "delivered");
    expect(await status(id)).toBe("accessioned");
    expect(await history(id)).toEqual(["wanted→on_order", "on_order→accessioned"]);
  });

  it("brings the delivered book's copy to the order's destination, once, and links it", async () => {
    const id = await work("wanted");
    const amsterdam = await place();
    const o = await order(id, amsterdam);
    await updateOrder(o.id, { price: "18.00", totalCost: "21.50", currency: "EUR" });
    const delivered = await updateOrderStatus(o.id, "delivered");

    const [copy] = await copies();
    expect(copy).toMatchObject({
      locationId: amsterdam,
      subLocationId: null,
      format: "paperback",
      status: "available",
      acquisitionType: "purchased",
      acquisitionDate: delivered.actualDeliveryDate,
      acquisitionPrice: "21.50",
      acquisitionCurrency: "EUR",
    });
    // The order records the edition that arrived and the copy it brought in
    expect(delivered).toMatchObject({ instanceId: copy.id, editionId: copy.editionId });
    expect(recordActivity).toHaveBeenCalledWith("work", id, "work.instance_added", { targetId: copy.id });
    await expect(updateOrderStatus(o.id, "delivered")).rejects.toThrow("Invalid transition");
    expect(await copies()).toHaveLength(1);
  });

  it("brings a copy bought in a shop with the order, as a gift for a gift", async () => {
    const id = await work("wanted");
    const shelf = await place();
    for (const acquisitionMethod of ["in_store_purchase", "gift"] as const)
      await createOrder({ workId: id, acquisitionMethod, status: acquisitionMethod === "gift" ? "received" : "purchased", orderDate: "2026-09-25", destinationLocationId: shelf });
    expect((await copies()).map((c) => c.acquisitionType).sort()).toEqual(["gift", "purchased"]);
    expect(await status(id)).toBe("accessioned");
  });

  it("puts the copy at the location for new copies when the order names none, and refuses what it cannot place", async () => {
    const noEdition = (await db.insert(schema.works).values({ title: "Là-bas", catalogueStatus: "wanted" }).returning())[0].id;
    const twoEditions = await work("wanted");
    await edition(twoEditions);
    const oneEdition = await work("wanted");
    const refused = [
      [await order(noEdition), "This book has no edition yet. Add the edition that arrived on the book's page first."],
      [await order(twoEditions), "This book has more than one edition. Choose the edition that arrived on the order first."],
      [await order(oneEdition), "Choose where the book arrives: set the order's destination, or a location for new copies in Settings."],
    ] as const;
    for (const [o, message] of refused) {
      await expect(updateOrderStatus(o.id, "delivered")).rejects.toThrow(message);
      expect((await db.select().from(schema.orders).where(eq(schema.orders.id, o.id)))[0].status).toBe("placed");
    }
    expect(await copies()).toEqual([]);

    // The location for new copies (Settings -> General) receives it; a digital one takes no paper format
    const ebooks = await place("eBooks", "digital");
    await db.insert(schema.appSettings).values({ newCopyLocationId: ebooks })
      .onConflictDoUpdate({ target: schema.appSettings.id, set: { newCopyLocationId: ebooks } });
    await updateOrderStatus(refused[2][0].id, "delivered");
    expect(await copies()).toMatchObject([{ locationId: ebooks, format: null, condition: null }]);
  });

  it("deaccessions the copy of a returned order", async () => {
    const id = await work("wanted");
    const o = await order(id, await place());
    await updateOrderStatus(o.id, "delivered");
    await updateOrderStatus(o.id, "returned");
    const [copy] = await copies();
    expect(copy).toMatchObject({
      status: "deaccessioned",
      dispositionType: "returned",
      dispositionDate: todayLocal(),
      dispositionNotes: "Returned to the seller",
    });
    expect(
      (await db.select().from(schema.instanceStatusHistory)).map((h) => [h.fromStatus, h.toStatus, h.notes]),
    ).toEqual([["available", "deaccessioned", "Returned to the seller"]]);
  });

  it("returns a cancelled order's work to the status it had before ordering", async () => {
    const wanted = await work("wanted");
    await updateOrderStatus((await order(wanted)).id, "cancelled");
    expect(await status(wanted)).toBe("wanted");

    const shortlisted = await work("shortlisted");
    await deleteOrder((await order(shortlisted)).id);
    expect(await status(shortlisted)).toBe("shortlisted");
    expect(await history(shortlisted)).toEqual([
      "shortlisted→on_order",
      "on_order→shortlisted",
    ]);
  });

  it("never demotes an owned work when another copy is ordered, cancelled or deleted", async () => {
    const id = await work("accessioned");
    const first = await order(id);
    expect(await status(id)).toBe("accessioned");
    await updateOrderStatus(first.id, "cancelled");
    expect(await status(id)).toBe("accessioned");
    await deleteOrder((await order(id)).id);
    expect(await status(id)).toBe("accessioned");
    expect(await history(id)).toEqual([]);
  });

  it("records a deleted order on the work's activity timeline", async () => {
    const id = await work("wanted");
    const o = await order(id);
    await deleteOrder(o.id);
    expect(recordActivity).toHaveBeenCalledWith("work", id, "work.order_deleted", {
      oldValue: "placed",
      extra: { orderId: o.id },
    });
    // The order and its own history are gone; no history row is written for it
    expect(await db.select().from(schema.orderStatusHistory)).toEqual([]);
  });

  it("refuses to delete a received order, and says its status in words", async () => {
    const id = await work("wanted");
    const o = await order(id, await place());
    await updateOrderStatus(o.id, "delivered");
    await expect(deleteOrder(o.id)).rejects.toThrow(
      'Cannot delete a "Delivered" order. Consider updating its status instead.',
    );
    await expect(updateOrderStatus(o.id, "placed")).rejects.toThrow('Invalid transition from "Delivered" to "Placed"');
  });

  it("refuses to delete a book whose order has it in hand, naming the order, and counts what goes (SLN-1112)", async () => {
    const id = await work("wanted");
    const [venue] = await db
      .insert(schema.venues)
      .values({ name: "Shakespeare and Company", type: "bookshop" })
      .returning();
    const o = await createOrder({
      workId: id,
      acquisitionMethod: "online_order",
      orderDate: "2026-09-25",
      venueId: venue.id,
      destinationLocationId: await place(),
    });
    await db.insert(schema.acquisitionTargets).values({ workId: id });
    await updateOrderStatus(o.id, "delivered");
    const refusal =
      `"Against Nature" has an order marked Delivered (from Shakespeare and Company, 25 September 2026), which is its acquisition record. Record the order's return under Orders on the book's page before deleting the book.`;

    expect(await getWorkDeleteSummary([id])).toMatchObject({ orders: 1, targets: 1, editions: 1, copies: 1, refusal });
    // The reason reaches the screen as data, not as the generic production error
    expect(await deleteWorkForScreen(id)).toEqual({ ok: false, error: refusal });
    await expect(deleteWork(id)).rejects.toThrow(refusal);
    expect(await status(id)).toBe("accessioned");

    // Once the order is returned, the book goes with its order, history and target
    await updateOrderStatus(o.id, "returned");
    expect((await getWorkDeleteSummary([id])).refusal).toBeNull();
    expect(await deleteWorkForScreen(id)).toMatchObject({ ok: true });
    expect(await db.select().from(schema.orders)).toEqual([]);
    expect(await db.select().from(schema.orderStatusHistory)).toEqual([]);
    expect(await db.select().from(schema.acquisitionTargets)).toEqual([]);
  });
});
