import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";
import * as schema from "@/lib/db/schema";

/** POST /api/media/logo-card (SLN-441) against PostgreSQL, with S3 in memory */
// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_LOGO_CARDS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln441_logo_cards")
    throw new Error("Logo card tests require disposable local sln441_logo_cards");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_, key) => (testDb ? Reflect.get(testDb, key) : undefined) }),
}));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, key) => String(key) }),
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
const { store } = vi.hoisted(() => ({ store: new Map<string, Buffer>() }));
vi.mock("@/lib/s3/covers", () => ({
  uploadToS3: vi.fn(async (key: string, body: Buffer) => void store.set(key, body)),
  deleteFromS3: vi.fn(async (key: string) => void store.delete(key)),
}));
vi.mock("@/lib/s3/read-object", () => ({
  readS3Object: vi.fn(async (key: string) => {
    const body = store.get(key);
    if (!body) throw new Error("missing");
    return body;
  }),
}));
import { POST } from "@/app/api/media/logo-card/route";

const logo = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#fff"/><circle cx="200" cy="200" r="150" fill="#f37021"/><circle cx="200" cy="200" r="60" fill="#fff"/></svg>`,
);
function request(fields: Record<string, string | Blob>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new NextRequest("http://local/api/media/logo-card", { method: "POST", body: form });
}
const svgFile = () => new File([logo], "penguin.svg", { type: "image/svg+xml" });

describe.skipIf(!url)("logo cards with PostgreSQL", () => {
  const db = testDb!;
  let orgId: string;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    store.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db.execute(sql`truncate publishing_houses cascade`);
    const [org] = await db.insert(schema.publishingHouses).values({ name: "Penguin", slug: "penguin" }).returning();
    orgId = org.id;
  });

  it("previews the card as a PNG and stores nothing", async () => {
    const res = await POST(request({ organizationId: orgId, file: svgFile(), preview: "1", options: "{}" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 800]);
    expect(store.size).toBe(0);
    expect(await db.select().from(schema.media)).toEqual([]);
  });

  it("saves the card as the active logo, the original kept beside it, never as SVG", async () => {
    const res = await POST(request({ organizationId: orgId, file: svgFile(), options: JSON.stringify({ size: 1 }) }));
    expect(res.status).toBe(200);
    const [row] = await db.select().from(schema.media).where(eq(schema.media.organizationId, orgId));
    expect(row).toMatchObject({ type: "poster", isActive: true, width: 1200, height: 800, originalFilename: "penguin.svg" });
    expect(row.processingParams).toEqual({
      logoCard: { invert: false, keepColours: false, emblemOnly: false, badge: false, size: 1 },
    });
    expect(row.originalS3Key).toBeTruthy();
    const original = store.get(row.originalS3Key!)!;
    expect((await sharp(original).metadata()).format).toBe("webp");
    for (const body of store.values()) expect(body.toString("utf8", 0, 200)).not.toContain("<svg");
  });

  it("runs the switches again on a saved card's original", async () => {
    await POST(request({ organizationId: orgId, file: svgFile(), options: "{}" }));
    const [first] = await db.select().from(schema.media);
    const preview = await POST(
      request({ organizationId: orgId, mediaId: first.id, preview: "1", options: JSON.stringify({ invert: true }) }),
    );
    expect(preview.status).toBe(200);
    const saved = await POST(request({ organizationId: orgId, mediaId: first.id, options: JSON.stringify({ badge: true }) }));
    expect(saved.status).toBe(200);
    const rows = await db.select().from(schema.media).where(eq(schema.media.isActive, true));
    expect(rows).toHaveLength(1);
    expect(rows[0].processingParams).toMatchObject({ logoCard: { badge: true } });
  });

  it("refuses bad input with a reason, and stores nothing", async () => {
    const blank = new File(
      [Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#fff"/></svg>`)],
      "blank.svg",
      { type: "image/svg+xml" },
    );
    const cases: [Record<string, string | Blob>, number][] = [
      [{ organizationId: "nope", file: svgFile() }, 400],
      [{ organizationId: orgId }, 400],
      [{ organizationId: orgId, file: new File([Buffer.from("hello")], "a.txt", { type: "text/plain" }) }, 400],
      [{ organizationId: orgId, file: new File([Buffer.from("not an image")], "a.png", { type: "image/png" }) }, 400],
      [{ organizationId: orgId, file: blank }, 400],
      [{ organizationId: orgId, file: svgFile(), options: "{bad" }, 400],
      [{ organizationId: orgId, mediaId: "00000000-0000-4000-8000-000000000000" }, 404],
      [{ organizationId: "00000000-0000-4000-8000-000000000000", file: svgFile() }, 404],
    ];
    for (const [fields, status] of cases) expect((await POST(request(fields))).status, JSON.stringify(Object.keys(fields))).toBe(status);
    expect(await db.select().from(schema.media)).toEqual([]);
  });
});
