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
  deleteOrder,
  searchWorksForOrder,
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

  async function work(catalogueStatus: Status) {
    const [row] = await db
      .insert(schema.works)
      .values({ title: "Against Nature", catalogueStatus })
      .returning();
    return row.id;
  }
  function order(workId: string) {
    return createOrder({
      workId,
      acquisitionMethod: "online_order",
      orderDate: "2026-09-25",
    });
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

  it("follows a wanted work through order and delivery", async () => {
    const id = await work("wanted");
    const o = await order(id);
    expect(await status(id)).toBe("on_order");
    await updateOrderStatus(o.id, "delivered");
    expect(await status(id)).toBe("accessioned");
    expect(await history(id)).toEqual(["wanted→on_order", "on_order→accessioned"]);
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
    const o = await order(id);
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
    });
    await db.insert(schema.acquisitionTargets).values({ workId: id });
    await updateOrderStatus(o.id, "delivered");
    const refusal =
      '"Against Nature" has an order marked Delivered (from Shakespeare and Company, 25 September 2026), which is its acquisition record. Mark the order Returned before deleting the book.';

    expect(await getWorkDeleteSummary([id])).toMatchObject({ orders: 1, targets: 1, editions: 0, copies: 0, refusal });
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
