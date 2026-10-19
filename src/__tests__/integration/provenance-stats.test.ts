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
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_STATS_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln323_test");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln323_test"
  ) {
    throw new Error(
      "Provenance stats tests require a disposable local sln323_test database",
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
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import {
  createOrder,
  getProvenanceStats,
  updateOrder,
} from "@/lib/actions/orders";

describe.skipIf(!url)("provenance spend with PostgreSQL", () => {
  const db = testDb!;
  let workId: string;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln323_test");
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln323_test");
    const [work] = await db
      .insert(schema.works)
      .values({ title: "Ordered book", catalogueStatus: "wanted" })
      .returning();
    workId = work.id;
  }, 30000);
  async function order(
    status: typeof schema.orders.$inferInsert.status,
    totalCost: string | null,
    currency: string | null,
  ) {
    await db.insert(schema.orders).values({
      workId,
      acquisitionMethod: "online_order",
      status,
      orderDate: "2026-09-26",
      price: totalCost,
      totalCost,
      currency,
    });
  }

  it("totals each currency apart and skips cancelled and returned orders", async () => {
    await order("confirmed", "267.46", "EUR");
    await order("delivered", "18.00", "EUR");
    await order("confirmed", "13.51", "GBP");
    await order("cancelled", "19.13", null);
    await order("returned", "40.00", "EUR");
    await order("placed", null, "USD");

    const stats = await getProvenanceStats();
    expect(stats.spentByCurrency).toEqual([
      { currency: "EUR", total: "285.46" },
      { currency: "GBP", total: "13.51" },
    ]);
    expect(stats.orderCount).toBe(6);
  });

  it("keeps active orders without a currency as their own line", async () => {
    await order("confirmed", "10.00", "EUR");
    await order("confirmed", "5.00", null);
    const stats = await getProvenanceStats();
    expect(stats.spentByCurrency).toEqual([
      { currency: "EUR", total: "10.00" },
      { currency: null, total: "5.00" },
    ]);
  });

  it("counts an order with a price but no total, as its card shows it (SLN-1485)", async () => {
    const priced = async (status: typeof schema.orders.$inferInsert.status, price: string, currency: string) =>
      db.insert(schema.orders).values({ workId, acquisitionMethod: "online_order", status, orderDate: "2026-09-26", price, totalCost: null, currency });
    await order("delivered", "10.00", "EUR");
    await priced("delivered", "5.00", "EUR");
    await priced("cancelled", "7.00", "EUR");
    await priced("delivered", "1200", "JPY");
    const stats = await getProvenanceStats();
    expect(stats.spentByCurrency).toEqual([
      { currency: "EUR", total: "15.00" },
      { currency: "JPY", total: "1200.00" },
    ]);
    expect(stats).not.toHaveProperty("avgOrderCost");
  });

  it("returns no totals when nothing was spent", async () => {
    await order("cancelled", "12.00", "EUR");
    expect((await getProvenanceStats()).spentByCurrency).toEqual([]);
  });

  it("rejects unsupported currencies on create and update without writing", async () => {
    await expect(
      createOrder({
        workId,
        acquisitionMethod: "online_order",
        orderDate: "2026-09-26",
        price: "9.00",
        totalCost: "9.00",
        currency: "Apples",
      }),
    ).rejects.toThrow();
    expect(await db.select().from(schema.orders)).toHaveLength(0);

    await order("confirmed", "9.00", null);
    const [saved] = await db.select().from(schema.orders);
    await expect(
      updateOrder(saved.id, { currency: "Pears" }),
    ).rejects.toThrow();
    await updateOrder(saved.id, { currency: "GBP" });
    const [updated] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, saved.id));
    expect(updated.currency).toBe("GBP");
  });
});
