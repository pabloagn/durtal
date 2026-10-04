import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

/**
 * The REST write routes (task 0174, SLN-417) against PostgreSQL: the bearer
 * token, input checks, the 404 and 409 answers, and that each write goes
 * through the app's own action (status history, catalogue status, slugs).
 */
// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_REST_WRITES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln417_rest_writes"
  )
    throw new Error("REST write tests require disposable local sln417_rest_writes");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
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
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, key) => String(key) }),
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/s3/covers", () => ({
  processAndUploadCover: vi.fn(async () => null),
  deleteFromS3: vi.fn(),
}));
import { GET as listOrders, POST as postOrder } from "@/app/api/orders/route";
import { GET as getOrderRoute, PATCH as patchOrder } from "@/app/api/orders/[id]/route";
import { POST as postStatus } from "@/app/api/orders/[id]/status/route";
import { POST as postInstance } from "@/app/api/instances/route";
import { PATCH as patchWork } from "@/app/api/works/[id]/route";
import { PATCH as patchEdition } from "@/app/api/editions/[id]/route";

const TOKEN = "test-rest-token";
const MISSING = "00000000-0000-4000-8000-000000000000";

function request(
  method: string,
  path: string,
  body?: unknown,
  token: string | null = TOKEN,
) {
  return new NextRequest(`http://local${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function answer(res: Response) {
  return { status: res.status, body: await res.json() };
}

describe.skipIf(!url)("REST write routes with PostgreSQL", () => {
  const db = testDb!;
  let workId: string, editionId: string, locationId: string;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    vi.stubEnv("DURTAL_API_TOKEN", TOKEN);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db.execute(sql`truncate works, orders, locations, recommenders, activity_events cascade`);
    const [work] = await db
      .insert(schema.works)
      .values({ title: "Against Nature", slug: "against-nature", catalogueStatus: "wanted" })
      .returning();
    workId = work.id;
    const [edition] = await db
      .insert(schema.editions)
      .values({ workId, title: "Against Nature" })
      .returning();
    editionId = edition.id;
    const [location] = await db
      .insert(schema.locations)
      .values({ name: "Study", type: "physical" })
      .returning();
    locationId = location.id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const order = (extra: Record<string, unknown> = {}) => ({
    workId,
    acquisitionMethod: "online_order",
    orderDate: "2026-10-03",
    ...extra,
  });
  async function workRow() {
    const [row] = await db.select().from(schema.works).where(eq(schema.works.id, workId));
    return row;
  }

  describe("the bearer token", () => {
    const writes: [string, () => Promise<Response>][] = [
      ["POST /api/orders", () => postOrder(request("POST", "/api/orders", {}, null))],
      ["PATCH /api/orders/[id]", () => patchOrder(request("PATCH", "/api/orders/x", {}, null), params(MISSING))],
      ["POST /api/orders/[id]/status", () => postStatus(request("POST", "/x", {}, null), params(MISSING))],
      ["POST /api/instances", () => postInstance(request("POST", "/api/instances", {}, null))],
      ["PATCH /api/works/[id]", () => patchWork(request("PATCH", "/x", {}, null), params(MISSING))],
      ["PATCH /api/editions/[id]", () => patchEdition(request("PATCH", "/x", {}, null), params(MISSING))],
    ];
    it.each(writes)("%s refuses a request without the token", async (_, call) => {
      expect((await call()).status).toBe(401);
    });

    it("refuses a wrong token, and every write while no token is set", async () => {
      expect((await postOrder(request("POST", "/api/orders", order(), "wrong-token"))).status).toBe(401);
      vi.stubEnv("DURTAL_API_TOKEN", "");
      const res = await postOrder(request("POST", "/api/orders", order()));
      expect(await answer(res)).toEqual({
        status: 503,
        body: { error: "Writes are disabled: DURTAL_API_TOKEN is not set" },
      });
      expect(await db.select().from(schema.orders)).toEqual([]);
    });

    it("lets reads through without the token", async () => {
      const res = await listOrders(request("GET", "/api/orders", undefined, null));
      expect(await answer(res)).toEqual({ status: 200, body: { orders: [] } });
    });
  });

  describe("orders", () => {
    it("creates an order as the app does, with its status history and the work's status", async () => {
      const created = await answer(await postOrder(request("POST", "/api/orders", order({ price: "12.50" }))));
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ workId, status: "placed", price: "12.50" });
      const history = await db
        .select()
        .from(schema.orderStatusHistory)
        .where(eq(schema.orderStatusHistory.orderId, created.body.id));
      expect(history.map((h) => h.toStatus)).toEqual(["placed"]);
      expect((await workRow()).catalogueStatus).toBe("on_order");
      const listed = await answer(await listOrders(request("GET", `/api/orders?workId=${workId}`, undefined, null)));
      expect(listed.body.orders.map((o: { id: string }) => o.id)).toEqual([created.body.id]);
    });

    it("refuses a second active order with 409, unless allowDuplicate=1", async () => {
      const first = await answer(await postOrder(request("POST", "/api/orders", order())));
      const again = await answer(await postOrder(request("POST", "/api/orders", order())));
      expect(again).toEqual({
        status: 409,
        body: {
          error: "The work already has an active order",
          orders: [{ id: first.body.id, status: "placed" }],
        },
      });
      const second = await postOrder(request("POST", "/api/orders?allowDuplicate=1", order()));
      expect(second.status).toBe(201);
      expect(await db.select().from(schema.orders)).toHaveLength(2);
    });

    it("answers 400 for an invalid body and 404 for an unknown work", async () => {
      const invalid = await answer(await postOrder(request("POST", "/api/orders", { workId })));
      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toBe("Invalid input");
      expect((await postOrder(request("POST", "/api/orders", "not json"))).status).toBe(400);
      const unknown = await answer(await postOrder(request("POST", "/api/orders", order({ workId: MISSING }))));
      expect(unknown).toEqual({ status: 404, body: { error: "Work not found" } });
    });

    it("PATCH changes details, and refuses status and unknown fields", async () => {
      const { body } = await answer(await postOrder(request("POST", "/api/orders", order())));
      const patched = await answer(
        await patchOrder(request("PATCH", "/x", { carrier: "PostNL", trackingNumber: "3S123" }), params(body.id)),
      );
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ carrier: "PostNL", trackingNumber: "3S123", status: "placed" });
      expect((await patchOrder(request("PATCH", "/x", { status: "delivered" }), params(body.id))).status).toBe(400);
      expect((await patchOrder(request("PATCH", "/x", { carier: "typo" }), params(body.id))).status).toBe(400);
      expect((await patchOrder(request("PATCH", "/x", { carrier: "DHL" }), params(MISSING))).status).toBe(404);
      expect((await patchOrder(request("PATCH", "/x", { carrier: "DHL" }), params("not-a-uuid"))).status).toBe(400);
      const read = await answer(await getOrderRoute(request("GET", "/x", undefined, null), params(body.id)));
      expect(read.body.carrier).toBe("PostNL");
    });

    it("moves the status, records it, and refuses an invalid move with the allowed ones", async () => {
      const { body } = await answer(await postOrder(request("POST", "/api/orders", order())));
      const delivered = await answer(
        await postStatus(request("POST", "/x", { status: "delivered", notes: "In the letterbox" }), params(body.id)),
      );
      expect(delivered.status).toBe(200);
      expect(delivered.body.status).toBe("delivered");
      expect(delivered.body.actualDeliveryDate).toBeTruthy();
      const history = await db
        .select({ to: schema.orderStatusHistory.toStatus })
        .from(schema.orderStatusHistory)
        .where(eq(schema.orderStatusHistory.orderId, body.id));
      expect(history.map((h) => h.to).sort()).toEqual(["delivered", "placed"]);
      expect((await workRow()).catalogueStatus).toBe("accessioned");
      const back = await answer(await postStatus(request("POST", "/x", { status: "shipped" }), params(body.id)));
      expect(back).toEqual({
        status: 409,
        body: { error: 'Cannot move from "delivered" to "shipped"', allowed: ["returned"] },
      });
      expect((await postStatus(request("POST", "/x", { status: "flying" }), params(body.id))).status).toBe(400);
      expect((await postStatus(request("POST", "/x", { status: "shipped" }), params(MISSING))).status).toBe(404);
    });
  });

  describe("copies", () => {
    it("adds a copy of an edition at a location", async () => {
      const created = await answer(
        await postInstance(request("POST", "/api/instances", { editionId, locationId, condition: "fine" })),
      );
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ editionId, locationId, status: "available", condition: "fine" });
      expect(await db.select().from(schema.instances)).toHaveLength(1);
    });

    it("answers 404 for an unknown edition or location, and 400 for an invalid body", async () => {
      expect(
        await answer(await postInstance(request("POST", "/api/instances", { editionId: MISSING, locationId }))),
      ).toEqual({ status: 404, body: { error: "Edition not found" } });
      expect(
        await answer(await postInstance(request("POST", "/api/instances", { editionId, locationId: MISSING }))),
      ).toEqual({ status: 404, body: { error: "Location not found" } });
      expect((await postInstance(request("POST", "/api/instances", { editionId }))).status).toBe(400);
      expect(await db.select().from(schema.instances)).toEqual([]);
    });
  });

  describe("works", () => {
    it("renames a work, and its slug follows", async () => {
      const res = await answer(await patchWork(request("PATCH", "/x", { title: "À rebours" }), params(workId)));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: workId, title: "À rebours", catalogueStatus: "wanted" });
      expect(res.body.slug).not.toBe("against-nature");
      expect((await workRow()).slug).toBe(res.body.slug);
    });

    it("changes the catalogue status and adds recommenders, keeping the existing ones", async () => {
      const [a, b] = await db
        .insert(schema.recommenders)
        .values([{ name: "Des Esseintes" }, { name: "Huysmans Society" }])
        .returning();
      await patchWork(request("PATCH", "/x", { addRecommenderIds: [a.id] }), params(workId));
      const res = await answer(
        await patchWork(
          request("PATCH", "/x", { catalogueStatus: "shortlisted", addRecommenderIds: [a.id, b.id] }),
          params(workId),
        ),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ catalogueStatus: "shortlisted", recommendersAdded: 1 });
      expect([...res.body.recommenderIds].sort()).toEqual([a.id, b.id].sort());
    });

    it("sets a half star, clears the rating, and refuses one out of range or between half steps", async () => {
      let res = await answer(await patchWork(request("PATCH", "/x", { rating: 4 }), params(workId)));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ rating: 4, catalogueStatus: "wanted" });
      res = await answer(await patchWork(request("PATCH", "/x", { rating: null }), params(workId)));
      expect(res.body).toMatchObject({ rating: null });
      expect((await workRow()).rating).toBeNull();
      expect((await patchWork(request("PATCH", "/x", { rating: 6 }), params(workId))).status).toBe(400);
      expect((await patchWork(request("PATCH", "/x", { rating: 4.3 }), params(workId))).status).toBe(400);
      expect((await patchWork(request("PATCH", "/x", { rating: 0 }), params(workId))).status).toBe(400);
      expect((await workRow()).rating).toBeNull();
      res = await answer(await patchWork(request("PATCH", "/x", { rating: 2.5 }), params(workId)));
      expect(res.body).toMatchObject({ rating: 2.5 });
    });

    it("refuses unknown fields, an unknown work and an invalid id", async () => {
      expect((await patchWork(request("PATCH", "/x", { titel: "typo" }), params(workId))).status).toBe(400);
      expect((await patchWork(request("PATCH", "/x", { title: "X" }), params(MISSING))).status).toBe(404);
      expect((await patchWork(request("PATCH", "/x", { title: "X" }), params("nope"))).status).toBe(400);
      expect((await workRow()).title).toBe("Against Nature");
    });

    it("answers 404 for a recommender that does not exist, and writes nothing", async () => {
      const res = await answer(
        await patchWork(
          request("PATCH", "/x", { title: "Renamed", addRecommenderIds: [MISSING] }),
          params(workId),
        ),
      );
      expect(res).toEqual({ status: 404, body: { error: "Recommender not found" } });
      expect(await db.select().from(schema.workRecommenders)).toEqual([]);
      // The title in the same request is not written either
      expect((await workRow()).title).toBe("Against Nature");
    });
  });

  describe("editions", () => {
    it("renames an edition and its subtitle", async () => {
      const res = await answer(
        await patchEdition(request("PATCH", "/x", { title: "À rebours", subtitle: "Penguin Classics" }), params(editionId)),
      );
      expect(res).toEqual({
        status: 200,
        body: { id: editionId, title: "À rebours", subtitle: "Penguin Classics", workId },
      });
    });

    it("refuses other fields, an unknown edition and an invalid id", async () => {
      expect((await patchEdition(request("PATCH", "/x", { isbn13: "9780140447637" }), params(editionId))).status).toBe(400);
      expect((await patchEdition(request("PATCH", "/x", { title: "X" }), params(MISSING))).status).toBe(404);
      expect((await patchEdition(request("PATCH", "/x", { title: "X" }), params("nope"))).status).toBe(400);
      expect((await patchEdition(request("PATCH", "/x", { title: "" }), params(editionId))).status).toBe(400);
    });
  });
});
