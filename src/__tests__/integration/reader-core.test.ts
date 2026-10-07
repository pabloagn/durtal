import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_READER_CORE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln492_reader_core")
    throw new Error("Reader core tests require disposable local sln492_reader_core");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));

import { NextRequest } from "next/server";
import { devicePositions, ebookAndFile, positionBodySchema, savePosition } from "@/lib/reader/positions";
import { readReaderBook } from "@/lib/ebooks/delivery/reader-book";
import { getRecentlyOpened } from "@/lib/ebooks/queries";
import { GET as positionGet, POST as positionPost } from "@/app/api/reader/[ebookId]/position/route";

/*
 * SLN-492: the reader's places on PostgreSQL (newest by the reader's clock
 * wins, the furthest progression only grows, one row per file and device)
 * and the reader page's one query.
 */

const phone = "0b7c6f0e-6a55-4a3e-9d33-1f1e7c2b9a10";
const laptop = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const T0 = Date.parse("2026-10-01T12:00:00Z");

describe.skipIf(!url)("reader core", () => {
  const c = client!;
  let ebookId: string;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`delete from ebook_positions`;
    await c`update ebooks set preferred_file_id = null`;
    await c`delete from ebook_files`;
    await c`delete from ebooks`;
    [{ id: ebookId }] = await c`insert into ebooks(title, authors, import_source) values ('À rebours', ${["J.-K. Huysmans"]}, 'folder') returning id`;
  });

  async function file(format: string, over: { status?: string; drm?: string | null; ebook?: string } = {}) {
    const sha = randomUUID().replace(/-/g, "").repeat(2);
    const [row] = await c`insert into ebook_files(ebook_id, sha256, format, size_bytes, content_type, s3_key, status, drm)
      values (${over.ebook ?? ebookId}, ${sha}, ${format}, 1000, 'application/octet-stream', ${`files/${sha.slice(0, 2)}/${sha}.${format}`},
        ${over.status ?? "stored"}, ${over.drm ?? null})
      returning id, sha256`;
    return { id: row.id as string, sha256: row.sha256 as string };
  }

  const body = (fileId: string, sha256: string, progression: number, at: number, chapter: string | null = "Chapter I") =>
    positionBodySchema(at).parse({
      fileId,
      locator: { v: 1, fileHash: sha256, href: "ch1.xhtml", sectionIndex: 1, progression: 0.5, totalProgression: progression },
      chapter,
      clientUpdatedAt: new Date(at).toISOString(),
    });

  describe("places", () => {
    it("keeps the newest place by the reader's clock, and the furthest progression ever sent", async () => {
      const epub = await file("epub");
      const first = await savePosition({ ebookId, deviceId: phone, deviceLabel: "iPhone · Safari", body: body(epub.id, epub.sha256, 0.4, T0) });
      expect(first.saved).toBe(true);
      expect(first.position).toMatchObject({ fileId: epub.id, progression: expect.closeTo(0.4, 5), furthestProgression: expect.closeTo(0.4, 5), chapter: "Chapter I" });

      // Back to an earlier page, later: the place moves back, the furthest stays
      const back = await savePosition({ ebookId, deviceId: phone, deviceLabel: "iPhone · Safari", body: body(epub.id, epub.sha256, 0.2, T0 + 60_000, "Notice") });
      expect(back.saved).toBe(true);
      expect(back.position).toMatchObject({ progression: expect.closeTo(0.2, 5), furthestProgression: expect.closeTo(0.4, 5), chapter: "Notice" });

      // A request that arrives late, sent before: the place stays, a further progression still counts
      const late = await savePosition({ ebookId, deviceId: phone, deviceLabel: "iPhone · Chrome", body: body(epub.id, epub.sha256, 0.9, T0 + 30_000) });
      expect(late.saved).toBe(false);
      expect(late.position).toMatchObject({ progression: expect.closeTo(0.2, 5), furthestProgression: expect.closeTo(0.9, 5), chapter: "Notice", deviceLabel: "iPhone · Safari" });
      expect(late.position.clientUpdatedAt.getTime()).toBe(T0 + 60_000);

      expect(await c`select count(*)::int as n from ebook_positions`).toEqual([{ n: 1 }]);
    });

    it("keeps one place per file and device, newest first", async () => {
      const epub = await file("epub");
      const pdf = await file("pdf");
      await savePosition({ ebookId, deviceId: phone, deviceLabel: "iPhone · Safari", body: body(epub.id, epub.sha256, 0.3, T0) });
      await savePosition({ ebookId, deviceId: phone, deviceLabel: "iPhone · Safari", body: body(pdf.id, pdf.sha256, 0.6, T0 + 1000) });
      await savePosition({ ebookId, deviceId: laptop, deviceLabel: "Mac · Firefox", body: body(epub.id, epub.sha256, 0.8, T0 + 2000) });
      expect((await devicePositions(ebookId, phone)).map((p) => [p.fileId, p.progression])).toEqual([
        [pdf.id, expect.closeTo(0.6, 5)],
        [epub.id, expect.closeTo(0.3, 5)],
      ]);
      expect((await devicePositions(ebookId, laptop)).map((p) => p.deviceLabel)).toEqual(["Mac · Firefox"]);
      expect(await devicePositions(ebookId, randomUUID())).toEqual([]);
    });

    it("goes with its file", async () => {
      const epub = await file("epub");
      await savePosition({ ebookId, deviceId: phone, deviceLabel: "iPhone · Safari", body: body(epub.id, epub.sha256, 0.3, T0) });
      await c`delete from ebook_files where id = ${epub.id}`;
      expect(await devicePositions(ebookId, phone)).toEqual([]);
    });

    it("tells an unknown e-book from a file of another one", async () => {
      const epub = await file("epub");
      const [{ id: other }] = await c`insert into ebooks(title, import_source) values ('Là-bas', 'folder') returning id`;
      const theirs = await file("epub", { ebook: other });
      expect(await ebookAndFile(ebookId, epub.id)).toEqual({ ebook: true, fileOfEbook: true });
      expect(await ebookAndFile(ebookId, theirs.id)).toEqual({ ebook: true, fileOfEbook: false });
      expect(await ebookAndFile(randomUUID(), epub.id)).toEqual({ ebook: false, fileOfEbook: false });
    });
  });

  describe("the position route", () => {
    const call = (method: "GET" | "POST", payload?: unknown, deviceId = phone) =>
      (method === "GET" ? positionGet : positionPost)(
        new NextRequest(`http://localhost/api/reader/${ebookId}/position`, {
          method,
          headers: { cookie: `durtal-device=${deviceId}`, "user-agent": "Mozilla/5.0 (Macintosh; rv:131.0) Gecko/20100101 Firefox/131.0" },
          body: payload === undefined ? undefined : JSON.stringify(payload),
        }),
        { params: Promise.resolve({ ebookId }) },
      );

    it("saves a place from the reader and gives it back to this device only", async () => {
      const epub = await file("epub");
      const at = new Date().toISOString();
      const locator = { v: 1, fileHash: epub.sha256, href: "ch2.xhtml", sectionIndex: 2, progression: 0.25, totalProgression: 0.3 };
      const saved = await call("POST", { fileId: epub.id, locator, chapter: "Chapter II", clientUpdatedAt: at });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ saved: true, position: { fileId: epub.id, chapter: "Chapter II", deviceLabel: "Mac · Firefox" } });
      expect((await (await call("GET")).json()).positions).toMatchObject([{ fileId: epub.id, locator }]);
      expect((await (await call("GET", undefined, laptop)).json()).positions).toEqual([]);
    });

    it("refuses a file of another e-book before saving", async () => {
      const [{ id: other }] = await c`insert into ebooks(title, import_source) values ('Là-bas', 'folder') returning id`;
      const theirs = await file("epub", { ebook: other });
      const locator = { v: 1, fileHash: theirs.sha256, href: "a", sectionIndex: 0, progression: 0, totalProgression: 0 };
      const res = await call("POST", { fileId: theirs.id, locator, chapter: null, clientUpdatedAt: new Date().toISOString() });
      expect(res.status).toBe(400);
      expect(await c`select count(*)::int as n from ebook_positions`).toEqual([{ n: 0 }]);
    });
  });

  describe("recently opened", () => {
    it("lists the place just saved, newest e-book first", async () => {
      const epub = await file("epub");
      const [{ id: other }] = await c`insert into ebooks(title, import_source) values ('Là-bas', 'folder') returning id`;
      const theirs = await file("pdf", { ebook: other });
      await savePosition({ ebookId: other, deviceId: phone, deviceLabel: "iPhone · Safari", body: body(theirs.id, theirs.sha256, 0.5, T0) });
      await savePosition({ ebookId, deviceId: laptop, deviceLabel: "Mac · Firefox", body: body(epub.id, epub.sha256, 0.4567, T0, "Chapter IV") });
      const recent = await getRecentlyOpened(5);
      expect(recent.map((r) => [r.title, r.fileId, r.percent, r.chapter, r.deviceLabel])).toEqual([
        ["À rebours", epub.id, 45.67, "Chapter IV", "Mac · Firefox"],
        ["Là-bas", theirs.id, 50, "Chapter I", "iPhone · Safari"],
      ]);
    });
  });

  describe("the reader page's query", () => {
    it("lists the readable files in format order and opens the preferred one", async () => {
      const pdf = await file("pdf");
      const epub = await file("epub");
      await file("epub", { drm: "adobe-adept" });
      await file("mobi", { status: "missing" });
      await file("djvu");
      let book = await readReaderBook(ebookId);
      expect(book).toMatchObject({ title: "À rebours", authors: ["J.-K. Huysmans"], workSlug: null, place: null });
      expect(book!.files.map((f) => f.id)).toEqual([epub.id, pdf.id]);
      expect(book!.file?.id).toBe(epub.id);

      await c`update ebooks set preferred_file_id = ${pdf.id} where id = ${ebookId}`;
      book = await readReaderBook(ebookId);
      expect(book!.file?.id).toBe(pdf.id);
      // ?file= wins when it names a readable file of this e-book, in any case
      expect((await readReaderBook(ebookId, { fileId: epub.id.toUpperCase() }))!.file?.id).toBe(epub.id);
      expect((await readReaderBook(ebookId, { fileId: randomUUID() }))!.file?.id).toBe(pdf.id);
    });

    it("gives this device's place in the file it opens, and no other device's", async () => {
      const epub = await file("epub");
      const pdf = await file("pdf");
      await savePosition({ ebookId, deviceId: phone, deviceLabel: "iPhone · Safari", body: body(epub.id, epub.sha256, 0.3, T0) });
      await savePosition({ ebookId, deviceId: laptop, deviceLabel: "Mac · Firefox", body: body(pdf.id, pdf.sha256, 0.7, T0) });
      const book = await readReaderBook(ebookId, { deviceId: phone });
      expect(book!.place).toMatchObject({ fileId: epub.id, locator: { totalProgression: 0.3 } });
      expect((await readReaderBook(ebookId, { deviceId: phone, fileId: pdf.id }))!.place).toBeNull();
      expect((await readReaderBook(ebookId))!.place).toBeNull();
    });

    it("links the book's page while its copy is held", async () => {
      const [work] = await c`insert into works(title, slug) values ('À rebours', 'a-rebours') returning id`;
      const [edition] = await c`insert into editions(work_id, title) values (${work.id}, 'À rebours') returning id`;
      const [place] = await c`insert into locations(name, type) values ('eBooks', 'digital') returning id`;
      const [copy] = await c`insert into instances(edition_id, location_id, format) values (${edition.id}, ${place.id}, 'epub') returning id`;
      await c`update ebooks set instance_id = ${copy.id}, match_state = 'linked' where id = ${ebookId}`;
      expect((await readReaderBook(ebookId))!.workSlug).toBe("a-rebours");
      await c`update instances set status = 'deaccessioned' where id = ${copy.id}`;
      expect((await readReaderBook(ebookId))!.workSlug).toBeNull();
      await c`update ebooks set instance_id = null, match_state = 'pending' where id = ${ebookId}`;
      await c`delete from instances; delete from editions; delete from works; delete from locations`.simple();
    });

    it("gives null for an e-book that does not exist", async () => {
      expect(await readReaderBook(randomUUID())).toBeNull();
    });
  });
});
