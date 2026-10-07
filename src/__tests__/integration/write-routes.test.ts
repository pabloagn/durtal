import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import sharp from "sharp";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_WRITE_ROUTES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln515_write_routes")
    throw new Error("Write route tests require a disposable local sln515_write_routes database");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;

// An in-memory bucket for every S3 call: no request leaves the machine, and no key is needed
const bucket = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@/lib/s3/client", async () => (await import("@/__tests__/helpers/memory-bucket")).memoryS3Client(bucket));
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { POST as createComment, GET as listComments } from "@/app/api/comments/route";
import { PATCH as editComment, DELETE as deleteComment } from "@/app/api/comments/[commentId]/route";
import { POST as attachFile } from "@/app/api/comments/[commentId]/attachments/route";
import { DELETE as removeAttachment } from "@/app/api/comments/[commentId]/attachments/[attachmentId]/route";
import { POST as exportRoute } from "@/app/api/export/route";
import { GET as listAuthors } from "@/app/api/authors/route";
import { GET as getAuthorRoute } from "@/app/api/authors/[id]/route";
import { POST as applyCrops } from "@/app/api/media/apply-crops/route";
import { POST as backfillPalettes } from "@/app/api/media/backfill-palettes/route";
import { ingestMedia } from "@/lib/media/ingest";
import { createPerfume } from "@/lib/actions/perfumes";
import { createFilm } from "@/lib/actions/films";
import { createPainting } from "@/lib/actions/paintings";

// The write routes SLN-311 left out (SLN-515): each one's happy path and a
// refused input, against PostgreSQL, with S3 in memory.

const ADMIN = "test-admin-token";
const json = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
const picture = () => sharp({ create: { width: 800, height: 1200, channels: 3, background: { r: 120, g: 40, b: 30 } } }).jpeg().toBuffer();

describe.skipIf(!url)("the write routes SLN-311 left out, with PostgreSQL", () => {
  const db = testDb!;
  const q = (text: string, args: unknown[] = []) => client!.unsafe(text, args as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, args: unknown[] = []) => Object.values((await q(text, args))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  let bookId = "";
  let authorId = "";
  beforeEach(async () => {
    bucket.clear();
    vi.stubEnv("ADMIN_TOKEN", ADMIN);
    await q(`truncate works, authors, media, comments, activity_events, image_adjustments cascade`);
    authorId = await value(`insert into authors(name, slug, first_name, last_name) values ('Clarice Lispector', 'clarice-lispector', 'Clarice', 'Lispector') returning id`);
    bookId = await value(`insert into works(title, slug) values ('The Hour of the Star', 'the-hour-of-the-star') returning id`);
    await q(`insert into work_authors(work_id, author_id, role) values ($1, $2, 'author')`, [bookId, authorId]);
  });

  describe("comments", () => {
    const post = (body: unknown) => createComment(json("POST", "/api/comments", body));

    it("POST /api/comments saves a sanitized comment and its timeline event, and refuses a bad body", async () => {
      const res = await post({ entityType: "work", entityId: bookId, contentHtml: "<p>Read it twice<script>x()</script></p>" });
      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.contentHtml).toBe("<p>Read it twice</p>");
      expect(await value(`select event_key from activity_events where metadata->>'commentId' = $1`, [created.id])).toBe("work.comment_added");
      const listed = await (await listComments(json("GET", `/api/comments?entityType=work&entityId=${bookId}`))).json();
      expect(listed.map((c: { id: string }) => c.id)).toEqual([created.id]);
      // Refused: no text, an unknown kind of record, a record that does not exist
      expect((await post({ entityType: "work", entityId: bookId, contentHtml: "" })).status).toBe(400);
      expect((await post({ entityType: "planet", entityId: bookId, contentHtml: "<p>x</p>" })).status).toBe(400);
      expect((await post({ entityType: "work", entityId: crypto.randomUUID(), contentHtml: "<p>x</p>" })).status).toBe(404);
      expect(Number(await value(`select count(*) from comments`))).toBe(1);
    });

    it("PATCH and DELETE /api/comments/[id] edit and remove a comment, its event and its files, and refuse a bad id", async () => {
      const comment = await (await post({ entityType: "work", entityId: bookId, contentHtml: "<p>First</p>" })).json();
      const edited = await editComment(json("PATCH", "/x", { contentHtml: "<p>Second<img src=x onerror=y></p>" }), params({ commentId: comment.id }));
      expect(edited.status).toBe(200);
      expect((await edited.json()).contentHtml).not.toContain("onerror");
      expect((await editComment(json("PATCH", "/x", { contentHtml: "<p>x</p>" }), params({ commentId: "nope" }))).status).toBe(400);
      expect((await editComment(json("PATCH", "/x", { contentHtml: "" }), params({ commentId: comment.id }))).status).toBe(400);
      // A file under the comment's folder goes with it
      const form = new FormData();
      form.append("file", new File(["%PDF-1.4 notes"], "notes.pdf"));
      const attached = await (await attachFile(new NextRequest("http://localhost/x", { method: "POST", body: form }), params({ commentId: comment.id }))).json();
      expect(bucket.has(attached.s3Key)).toBe(true);
      expect((await deleteComment(json("DELETE", "/x"), params({ commentId: "nope" }))).status).toBe(400);
      expect((await deleteComment(json("DELETE", "/x"), params({ commentId: comment.id }))).status).toBe(200);
      expect(Number(await value(`select count(*) from comments`))).toBe(0);
      expect(Number(await value(`select count(*) from activity_events where metadata->>'commentId' = $1`, [comment.id]))).toBe(0);
      expect(bucket.has(attached.s3Key)).toBe(false);
      expect((await deleteComment(json("DELETE", "/x"), params({ commentId: comment.id }))).status).toBe(404);
    });

    it("POST and DELETE the attachments: a PDF is stored and removed; a file of another kind is refused", async () => {
      const comment = await (await post({ entityType: "work", entityId: bookId, contentHtml: "<p>With a file</p>" })).json();
      const upload = (name: string, content: string) => {
        const form = new FormData();
        form.append("file", new File([content], name));
        return attachFile(new NextRequest("http://localhost/x", { method: "POST", body: form }), params({ commentId: comment.id }));
      };
      const res = await upload("../scan.pdf", "%PDF-1.4 scan");
      expect(res.status).toBe(201);
      const attachment = await res.json();
      expect(attachment).toMatchObject({ fileName: "scan.pdf", mimeType: "application/pdf", isImage: false });
      expect(attachment.s3Key.startsWith(`gold/comments/work/${bookId}/${comment.id}/`)).toBe(true);
      expect(bucket.get(attachment.s3Key)?.toString()).toBe("%PDF-1.4 scan");
      const refused = await upload("run.exe", "MZ");
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toMatch(/cannot be attached/);
      expect((await removeAttachment(json("DELETE", "/x"), params({ commentId: comment.id, attachmentId: "nope" }))).status).toBe(400);
      expect((await removeAttachment(json("DELETE", "/x"), params({ commentId: comment.id, attachmentId: attachment.id }))).status).toBe(200);
      expect(bucket.has(attachment.s3Key)).toBe(false);
      expect(Number(await value(`select count(*) from comment_attachments`))).toBe(0);
    });
  });

  describe("export", () => {
    /** Rows in the tables an export could touch: it must write none */
    const counts = async () =>
      (await q(`select (select count(*) from works) w, (select count(*) from authors) a, (select count(*) from readings) r,
        (select count(*) from reading_notes) n, (select count(*) from activity_events) e, (select count(*) from imports) i`))[0];
    const exportOf = (body: unknown) => exportRoute(json("POST", "/api/export", body));

    beforeEach(async () => {
      // Through their own actions: an export reads each kind's details
      await createPerfume({ title: "Chanel No 5" });
      await createFilm({ title: "Stalker" });
      await createPainting({ title: "View of Delft" });
      const reading = await value(
        `insert into readings(work_id, status, started_precision, finished_on, finished_precision, rating) values ($1, 'finished', 'unknown', '2024-03-02', 'day', 4.5) returning id`,
        [bookId],
      );
      await q(`insert into reading_sessions(reading_id, format, read_on, time_zone, end_page) values ($1, 'print', '2024-03-01', 'Europe/Amsterdam', 40)`, [reading]);
      await q(`insert into reading_notes(work_id, kind, body) values ($1, 'quote', 'Everything in the world began with a yes.')`, [bookId]);
    });

    // Each export, what its file holds, and a format it does not offer
    it.each([
      ["works", { ids: "book" }, "The Hour of the Star", "md"],
      ["authors", { ids: "author" }, "Lispector", "md"],
      ["perfumes", { all: true }, "Chanel No 5", "md"],
      ["films", { all: true }, "Stalker", "md"],
      ["paintings", { all: true }, "View of Delft", "md"],
      ["readings", { all: true }, "The Hour of the Star", "md"],
      ["reading-sessions", { all: true }, "2024-03-01", "md"],
      ["reading-notes", { all: true }, "began with a yes", "html"],
      ["goodreads", { all: true }, "The Hour of the Star", "tsv"],
    ] as const)("POST /api/export %s: a CSV of its records, no data written; a format it does not offer is refused", async (entity, select, expected, wrongFormat) => {
      const before = await counts();
      const pick = "ids" in select ? { ids: [select.ids === "book" ? bookId : authorId] } : select;
      const res = await exportOf({ entity, format: "csv", ...pick });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="durtal-/);
      expect(await res.text()).toContain(expected);
      expect(await counts()).toEqual(before);
      const refused = await exportOf({ entity, format: wrongFormat, ...pick });
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toMatch(/Invalid format/);
    });

    it("POST /api/export refuses an unknown entity, ids that are not UUIDs and no selection", async () => {
      expect((await exportOf({ entity: "planets", format: "csv", all: true })).status).toBe(400);
      expect((await exportOf({ entity: "works", format: "csv", ids: ["nope"] })).status).toBe(400);
      expect((await exportOf({ entity: "works", format: "csv" })).status).toBe(400);
    });
  });

  describe("authors", () => {
    it("GET /api/authors lists and counts; GET /api/authors/[id] gives one and refuses a bad id", async () => {
      const list = await (await listAuthors(json("GET", "/api/authors?q=Lispector&limit=5"))).json();
      expect(list.total).toBe(1);
      expect(list.authors.map((a: { name: string }) => a.name)).toEqual(["Clarice Lispector"]);
      const one = await getAuthorRoute(json("GET", "/x"), params({ id: authorId }));
      expect(one.status).toBe(200);
      expect((await one.json()).name).toBe("Clarice Lispector");
      expect((await getAuthorRoute(json("GET", "/x"), params({ id: "not-a-uuid" }))).status).toBe(400);
      expect((await getAuthorRoute(json("GET", "/x"), params({ id: crypto.randomUUID() }))).status).toBe(404);
    });
  });

  describe("media maintenance", () => {
    const admin = (path: string) => new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "x-admin-token": ADMIN } });

    it("POST /api/media/apply-crops writes a cropped file for framing saved as CSS, and refuses a bad id", async () => {
      const poster = await ingestMedia({ owner: { type: "work", id: bookId }, mediaType: "poster", buffer: await picture() });
      await q(`update media set crop_zoom = 150 where id = $1`, [poster.id]);
      const dry = await (await applyCrops(admin("/api/media/apply-crops?dryRun=1"))).json();
      expect(dry).toMatchObject({ dryRun: true, total: 1 });
      const res = await applyCrops(admin(`/api/media/apply-crops?id=${poster.id}`));
      expect(await res.json()).toMatchObject({ total: 1, applied: 1, unchanged: 0, failed: [] });
      const [row] = await q(`select s3_key, uncropped_s3_key, crop_zoom from media where id = $1`, [poster.id]);
      expect(row.uncropped_s3_key).toBe(poster.s3Key);
      expect(row.s3_key).not.toBe(poster.s3Key);
      expect(bucket.has(row.s3_key)).toBe(true);
      expect(Number(row.crop_zoom)).toBe(100);
      // Run again: nothing left to move
      expect(await (await applyCrops(admin("/api/media/apply-crops"))).json()).toMatchObject({ total: 0 });
      expect((await applyCrops(admin("/api/media/apply-crops?id=nope"))).status).toBe(400);
    });

    it("POST /api/media/backfill-palettes colours a poster stored without a palette, and passes one whose file is gone", async () => {
      const poster = await ingestMedia({ owner: { type: "work", id: bookId }, mediaType: "poster", buffer: await picture() });
      await q(`update media set color_palette = null, color_bucket = null`);
      const dry = await (await backfillPalettes(admin("/api/media/backfill-palettes?dryRun=1"))).json();
      expect(dry.remaining.posters).toBe(1);
      expect(await value(`select color_palette is null from media where id = $1`, [poster.id])).toBe(true);
      const done = await (await backfillPalettes(admin("/api/media/backfill-palettes"))).json();
      expect(done.posters).toMatchObject({ processed: 1, failed: 0 });
      expect(await value(`select color_palette is not null and color_bucket is not null from media where id = $1`, [poster.id])).toBe(true);
      // A poster whose file is missing is reported and left as it is
      await q(`update media set color_palette = null, color_bucket = null`);
      bucket.clear();
      const missing = await (await backfillPalettes(admin("/api/media/backfill-palettes"))).json();
      expect(missing.posters).toMatchObject({ processed: 0, failed: 1 });
      expect(missing.errors[0]).toMatch(poster.id);
      expect(await value(`select color_palette is null from media where id = $1`, [poster.id])).toBe(true);
    });
  });
});
