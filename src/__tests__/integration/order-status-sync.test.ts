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
import { asc, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_ORDER_STATUS_TEST_DATABASE_URL;
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
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
const { recordActivity } = vi.hoisted(() => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity }));
import {
  createOrder,
  deleteOrder,
  updateOrderStatus,
} from "@/lib/actions/orders";

type Status = typeof schema.works.$inferSelect.catalogueStatus;

describe.skipIf(!url)("order status sync with PostgreSQL (SLN-280)", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE works, orders CASCADE`);
    recordActivity.mockClear();
  });

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
});
