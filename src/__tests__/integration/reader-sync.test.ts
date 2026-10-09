import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import { NextRequest } from "next/server";
const url = process.env.DURTAL_READER_SYNC_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln493_reader_sync"
  )
    throw new Error(
      "Reader sync tests require disposable local sln493_reader_sync",
    );
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
import { readReaderBook } from "@/lib/ebooks/delivery/reader-book";
import { ebookFileKey } from "@/lib/ebooks/keys";
import {
  allDevicePositions,
  savePosition,
  positionBodySchema,
} from "@/lib/reader/positions";
import { GET, POST } from "@/app/api/reader/[ebookId]/position/route";
const phone = randomUUID(),
  mac = randomUUID(),
  T0 = Date.parse("2026-10-01T10:00:00Z");
describe.skipIf(!url)("reader sync", () => {
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
    [{ id: ebookId }] =
      await c`insert into ebooks(title, import_source) values ('Reader sync fixture', 'folder') returning id`;
  });
  const file = async (format: string) => {
    const sha = randomUUID().replaceAll("-", "").repeat(2);
    const [row] =
      await c`insert into ebook_files(ebook_id, sha256, format, size_bytes, content_type, s3_key, status)
      values (${ebookId}, ${sha}, ${format}, 1000, 'application/octet-stream', ${ebookFileKey(sha, format)}, 'stored') returning id`;
    return { id: row.id as string, sha };
  };
  const body = (file: { id: string; sha: string }, fraction: number, at = T0) =>
    positionBodySchema(at).parse({
      fileId: file.id,
      chapter: "Chapter I",
      clientUpdatedAt: new Date(at).toISOString(),
      locator: {
        v: 1,
        fileHash: file.sha,
        sectionIndex: 1,
        href: "chapter",
        progression: 0.25,
        totalProgression: fraction,
      },
    });
  const save = (
    file: { id: string; sha: string },
    deviceId: string,
    fraction: number,
    at = T0,
  ) =>
    savePosition({
      ebookId,
      deviceId,
      deviceLabel: deviceId === phone ? "iPhone · Safari" : "Mac · Firefox",
      body: body(file, fraction, at),
    });
  it("returns current-file own history and newest other-file place in one query", async () => {
    const epub = await file("epub"),
      pdf = await file("pdf");
    await save(epub, mac, 0.2);
    await save(epub, phone, 0.3, T0 + 1000);
    await save(pdf, phone, 0.7, T0 + 2000);
    const execute = vi.spyOn(testDb!, "execute");
    const book = await readReaderBook(ebookId, {
      deviceId: mac,
      fileId: epub.id,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mockRestore();
    expect(book!.place).toMatchObject({
      fileId: epub.id,
      deviceId: mac,
      thisDevice: true,
    });
    expect(book!.otherPlace).toMatchObject({
      fileId: pdf.id,
      deviceId: phone,
      chapter: "Chapter I",
      thisDevice: false,
    });
    expect(book!.otherPlace!.progression).toBeCloseTo(0.7);
    const otherFormat = await readReaderBook(ebookId, {
      deviceId: mac,
      fileId: pdf.id,
    });
    expect(otherFormat!.place).toBeNull();
    expect(otherFormat!.devicePlace).toMatchObject({ fileId: epub.id });
    expect(
      (await readReaderBook(ebookId, { deviceId: randomUUID() }))!.devicePlace,
    ).toBeNull();
  });
  it("keeps two devices and two formats independent, even when older saves arrive late", async () => {
    const epub = await file("epub"),
      pdf = await file("pdf");
    await save(epub, mac, 0.4, T0 + 2000);
    await save(pdf, phone, 0.7, T0 + 1000);
    await save(epub, phone, 0.6, T0 + 3000);
    await save(epub, mac, 0.9, T0);
    const rows = await allDevicePositions(ebookId, mac);
    expect(
      rows.map((row) => [row.deviceId, row.fileId, row.thisDevice]),
    ).toEqual([
      [phone, epub.id, false],
      [mac, epub.id, true],
      [phone, pdf.id, false],
    ]);
    expect(rows[1].progression).toBeCloseTo(0.4);
    expect(rows[1].furthestProgression).toBeCloseTo(0.9);
  });
  it("GET returns exact all-device fields, cookie flags and anonymous places", async () => {
    const epub = await file("epub");
    await save(epub, mac, 0.4);
    const params = { params: Promise.resolve({ ebookId }) };
    const res = await GET(
      new NextRequest(`http://localhost/api/reader/${ebookId}/position`, {
        headers: { cookie: `durtal-device=${mac}` },
      }),
      params,
    );
    const row = (await res.json()).positions[0];
    expect(Object.keys(row).sort()).toEqual(
      [
        "deviceId",
        "deviceLabel",
        "fileId",
        "locator",
        "progression",
        "furthestProgression",
        "chapter",
        "clientUpdatedAt",
        "thisDevice",
      ].sort(),
    );
    expect(row.thisDevice).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const anonymous = await GET(
      new NextRequest(`http://localhost/api/reader/${ebookId}/position`),
      params,
    );
    expect((await anonymous.json()).positions[0].thisDevice).toBe(false);
  });
  it("actual POST and page/GET reads change no table except ebook_positions", async () => {
    const epub = await file("epub");
    const snapshot = async () => {
      const tables =
        await c`select tablename from pg_tables where schemaname = 'public' and tablename <> 'ebook_positions' order by tablename`;
      return Promise.all(
        tables.map(async ({ tablename }) => [
          tablename,
          await c`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') as rows from ${c(tablename)} t`,
        ]),
      );
    };
    const before = await snapshot();
    const data = body(epub, 0.4);
    const res = await POST(
      new NextRequest(
        `http://localhost/api/reader/${ebookId}/position?touch=1`,
        {
          method: "POST",
          headers: {
            cookie: `durtal-device=${mac}`,
            "user-agent":
              "Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15",
          },
          body: JSON.stringify({
            ...data,
            clientUpdatedAt: data.clientUpdatedAt.toISOString(),
          }),
        },
      ),
      { params: Promise.resolve({ ebookId }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).position.deviceLabel).toBe("iPad · Safari");
    await readReaderBook(ebookId, { deviceId: mac });
    await allDevicePositions(ebookId, mac);
    expect(await snapshot()).toEqual(before);
    expect(await c`select count(*)::int as n from ebook_positions`).toEqual([
      { n: 1 },
    ]);
  });
});
