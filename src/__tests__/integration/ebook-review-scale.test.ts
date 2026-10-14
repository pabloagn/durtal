import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";
import { ebookFileKey } from "@/lib/ebooks/keys";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
import { applyEbookReview, prepareEbookReview, type ReviewContext } from "@/lib/ebooks/review/service";

// SLN-691: a review preview on a library of 6,000 eBooks. Opt-in disposable
// database only, created by test:local; no DATABASE_URL fallback.
const url = process.env.DURTAL_EBOOK_REVIEW_SCALE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln691_review_scale")
    throw new Error("Review scale fixtures require disposable local sln691_review_scale");
}
const client = url ? postgres(url, { prepare: false, max: 3, onnotice: () => {} }) : null;
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get() {
  throw new Error("Review scale fixture must use its supplied connection");
} }) }));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(),
  CACHE_TAGS: { works: "works", editions: "editions", activity: "activity", authors: "authors", series: "series" } }));

const EBOOKS = 6000;
describe.skipIf(!url)("review previews on a 6,000 eBook library", () => {
  const c = client!;
  const database = (client ? drizzle(client, { schema }) : null) as unknown as Db;
  const context = (): ReviewContext => ({ channel: "ui", planningUrl: url!,
    targetDatabase: databaseFingerprint(url!), writeDb: database });
  let ids: string[] = [];
  beforeAll(async () => {
    await migrate(drizzle(c, { schema }), { migrationsFolder: "src/lib/db/migrations" });
    const locationId = randomUUID(), prefix = ebookFileKey("a".repeat(64), "epub").replace(/files\/.*$/, "");
    await c`insert into locations(id,name,type) values(${locationId},'eBooks','digital')`;
    await c`insert into app_settings(id,ebook_location_id) values(true,${locationId})
      on conflict(id) do update set ebook_location_id=excluded.ebook_location_id`;
    // Each file carries about 4 KB of library metadata, as an imported one does.
    await c`insert into ebooks(id,title,authors,language,import_source,updated_at)
      select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Scale eBook ' || n,
        array['Scale Author ' || (n % 400)], 'en', 'folder', '2026-01-01T00:00:00.123456Z'
      from generate_series(1, ${EBOOKS}) n`;
    await c`insert into ebook_files(id,ebook_id,sha256,format,size_bytes,content_type,s3_key,status,metadata)
      select ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
        ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, h, 'epub', 1000 + n, 'application/epub+zip',
        ${prefix} || 'files/' || left(h, 2) || '/' || h || '.epub', 'stored',
        jsonb_build_object('description', repeat('A long imported description. ', 140), 'subjects', jsonb_build_array('Fiction', 'Scale ' || n))
      from (select n, encode(sha256(convert_to('scale ' || n, 'UTF8')), 'hex') h from generate_series(1, ${EBOOKS}) n) f`;
    ids = (await c`select id from ebooks order by id limit 3`).map((row) => String(row.id));
  }, 180_000);
  afterAll(async () => { await client?.end(); });

  it("confirms an earlier preview after a later one, with the library's rows well over the old 32 MB cache", async () => {
    const [{ bytes }] = await c`select (select coalesce(sum(length(to_jsonb(f)::text)), 0) from ebook_files f) +
      (select coalesce(sum(length(to_jsonb(e)::text)), 0) from ebooks e) as bytes`;
    expect(Number(bytes)).toBeGreaterThan(32 * 1024 * 1024);
    const first = await prepareEbookReview({ action: "keep", ebookId: ids[0] }, context());
    const second = await prepareEbookReview({ action: "keep", ebookId: ids[1] }, context());
    expect((await applyEbookReview(first.request, first.previewToken, context())).message).toBe("Kept as a standalone eBook.");
    // The first keep changed the library the second preview was made on.
    await expect(applyEbookReview(second.request, second.previewToken, context()))
      .rejects.toMatchObject({ code: "stale_review", message: expect.stringContaining("library changed") });
    const kept = await c`select id from ebooks where match_state='standalone' order by id`;
    expect(kept.map((row) => String(row.id))).toEqual(ids.slice(0, 1));
  }, 300_000);
});
