import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";

const url = process.env.DURTAL_EBOOK_DELIVERY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln491_ebook_delivery")
    throw new Error("E-book delivery tests require disposable local sln491_ebook_delivery");
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

import { readCatalogueFile } from "@/lib/ebooks/delivery/files";
import { fileUrlFor } from "@/lib/ebooks/delivery/url";
import { GET as fileRoute } from "@/app/api/ebooks/files/[fileId]/route";
import { GET as urlRoute } from "@/app/api/ebooks/files/[fileId]/url/route";
import { ebookOrphans, runEbookVerification } from "@/lib/ebooks/verify";

/*
 * SLN-491: delivery and verification on PostgreSQL, with the e-book bucket
 * in memory (S3's answers to list, head with checksum, and ranged get).
 * Nothing here reaches AWS.
 */

const HOUR = 3600_000;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytesOf = (text: string) => new TextEncoder().encode(text);

interface StoredObject {
  bytes: Uint8Array;
  lastModified: Date;
  /** A multipart upload's checksum: of its parts, so only the metadata names the whole */
  composite?: boolean;
  metadataSha256?: string;
}
const bucket = new Map<string, StoredObject>();
let send: ReturnType<typeof vi.spyOn>;
/** The commands S3 was sent */
const sent = () => (send.mock.calls as [unknown][]).map(([command]) => command);

function fakeS3() {
  return vi.spyOn(S3Client.prototype, "send").mockImplementation((async (command: unknown) => {
    const missing = () => Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    if (command instanceof ListObjectsV2Command) {
      const { Prefix = "", ContinuationToken } = command.input;
      const keys = [...bucket.keys()].filter((k) => k.startsWith(Prefix)).sort();
      const start = ContinuationToken ? Number(ContinuationToken) : 0;
      const more = start + 2 < keys.length;
      return {
        Contents: keys.slice(start, start + 2).map((Key) => ({ Key, Size: bucket.get(Key)!.bytes.length, LastModified: bucket.get(Key)!.lastModified })),
        IsTruncated: more,
        NextContinuationToken: more ? String(start + 2) : undefined,
      };
    }
    if (command instanceof HeadObjectCommand) {
      const object = bucket.get(command.input.Key!);
      if (!object) throw missing();
      const digest = createHash("sha256").update(object.bytes).digest("base64");
      return {
        ContentLength: object.bytes.length,
        ...(command.input.ChecksumMode === "ENABLED" ? { ChecksumSHA256: object.composite ? `${digest}-3` : digest } : {}),
        Metadata: { sha256: object.metadataSha256 ?? sha(object.bytes) },
        LastModified: object.lastModified,
      };
    }
    if (command instanceof GetObjectCommand) {
      const object = bucket.get(command.input.Key!);
      if (!object) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      const [, a, b] = /^bytes=(\d+)-(\d*)$/.exec(command.input.Range!)!;
      const slice = object.bytes.slice(Number(a), b === "" ? undefined : Number(b) + 1);
      return { ContentLength: slice.length, Body: { transformToWebStream: () => new Blob([slice]).stream() } };
    }
    throw new Error("Unexpected S3 command");
  }) as never);
}

describe.skipIf(!url)("e-book delivery and verification", () => {
  const c = client!;
  const database = testDb as unknown as Db;
  let ebookId: string;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    bucket.clear();
    await c`delete from ebook_files`;
    await c`delete from ebooks`;
    [{ id: ebookId }] = await c`insert into ebooks(title, import_source) values ('À rebours', 'folder') returning id`;
    send = fakeS3();
  });
  afterEach(() => {
    send.mockRestore();
    vi.unstubAllEnvs();
  });

  /** One file row, and (unless `object: false`) its object in the bucket */
  async function file(text: string, over: { status?: string; drm?: string | null; size?: number; object?: false | Partial<StoredObject>; format?: string } = {}) {
    const bytes = bytesOf(text);
    const digest = sha(bytes);
    const key = `files/${digest.slice(0, 2)}/${digest}.${over.format ?? "epub"}`;
    if (over.object !== false) bucket.set(key, { bytes, lastModified: new Date(Date.now() - 48 * HOUR), ...over.object });
    const [row] = await c`insert into ebook_files(ebook_id, sha256, format, size_bytes, content_type, s3_key, status, drm)
      values (${ebookId}, ${digest}, ${over.format ?? "epub"}, ${over.size ?? bytes.length}, 'application/epub+zip', ${key}, ${over.status ?? "stored"}, ${over.drm ?? null})
      returning id`;
    return { id: row.id as string, key, digest, bytes };
  }
  const statusOf = async (id: string) => (await c`select status, verified_at from ebook_files where id = ${id}`)[0];

  describe("delivery", () => {
    it("signs only rows it read, under their own key", async () => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      vi.stubEnv("EBOOK_DELIVERY", "cloudfront");
      vi.stubEnv("EBOOK_CDN_URL", "https://d111111abcdef8.cloudfront.net");
      vi.stubEnv("EBOOK_CDN_KEY_PAIR_ID", "K2JCJMDEHXQW5F");
      vi.stubEnv("EBOOK_CDN_PRIVATE_KEY", Buffer.from(privateKey.export({ type: "pkcs1", format: "pem" }).toString()).toString("base64"));
      const stored = await file("Des Esseintes");
      const row = (await readCatalogueFile(stored.id))!;
      expect(fileUrlFor(row).url.startsWith(`https://d111111abcdef8.cloudfront.net/${stored.key}?Expires=`)).toBe(true);
      expect(await readCatalogueFile(randomUUID())).toBeNull();
      const res = await urlRoute(new NextRequest(`http://localhost/api/ebooks/files/${stored.id}/url`), { params: Promise.resolve({ fileId: stored.id }) });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.url.startsWith(`https://d111111abcdef8.cloudfront.net/${stored.key}?`)).toBe(true);
      expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThanOrEqual(6 * HOUR - 60_000);
    });

    it("the url route refuses quarantined, missing, replaced and DRM files, and an unknown one", async () => {
      const refused = [
        await file("quarantined", { status: "quarantined" }),
        await file("missing", { status: "missing" }),
        await file("replaced", { status: "replaced" }),
        await file("drm", { drm: "kindle" }),
      ];
      for (const { id } of [...refused, { id: randomUUID() }]) {
        const res = await urlRoute(new NextRequest(`http://localhost/api/ebooks/files/${id}/url`), { params: Promise.resolve({ fileId: id }) });
        expect(res.status, id).toBe(404);
      }
      const ok = await file("readable");
      const res = await urlRoute(new NextRequest(`http://localhost/api/ebooks/files/${ok.id}/url`), { params: Promise.resolve({ fileId: ok.id }) });
      expect(await res.json()).toEqual({ url: `/api/ebooks/files/${ok.id}`, expiresAt: null });
    });

    it("serves a range of a catalogued file from the bucket", async () => {
      const stored = await file("Against Nature, translated by Robert Baldick");
      const res = await fileRoute(new NextRequest(`http://localhost/api/ebooks/files/${stored.id}`, { headers: { range: "bytes=8-13" } }), {
        params: Promise.resolve({ fileId: stored.id }),
      });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe(`bytes 8-13/${stored.bytes.length}`);
      expect(await res.text()).toBe("Nature");
    });
  });

  describe("verification", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "durtal-ebook-verify-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    /** A catalogue with every case, and the objects no row names */
    async function catalogue() {
      const now = Date.now();
      const rows = {
        match: await file("a matching file"),
        gone: await file("an object that is gone", { object: false }),
        shorter: await file("a size that differs", { status: "verified", size: 9999 }),
        altered: await file("altered bytes", { object: { bytes: bytesOf("altered bytez") } }),
        multipart: await file("a multipart upload", { object: { composite: true } }),
        quarantined: await file("quarantined but present", { status: "quarantined" }),
        back: await file("missing before, present now", { status: "missing" }),
      };
      const stray = sha(bytesOf("stray"));
      bucket.set(`files/${stray.slice(0, 2)}/${stray}.pdf`, { bytes: bytesOf("stray"), lastModified: new Date(now - 30 * HOUR) });
      const young = sha(bytesOf("young"));
      bucket.set(`files/${young.slice(0, 2)}/${young}.pdf`, { bytes: bytesOf("young"), lastModified: new Date(now - HOUR) });
      bucket.set(`derived/${rows.match.digest}/cover-240.webp`, { bytes: bytesOf("webp"), lastModified: new Date(now - 30 * HOUR) });
      bucket.set(`derived/${stray}/manifest.json`, { bytes: bytesOf("{}"), lastModified: new Date(now - 30 * HOUR) });
      bucket.set(`staging/${randomUUID()}/original.epub`, { bytes: bytesOf("staged"), lastModified: new Date(now - 30 * HOUR) });
      return { rows, stray, young };
    }

    it("reports every case read-only, and writes nothing", async () => {
      const { rows, stray, young } = await catalogue();
      const { report, applied, files } = await runEbookVerification({ database, apply: false, reportDir: dir });
      expect(applied).toBeUndefined();
      const outcome = (id: string) => report.rows.find((r) => r.id === id)!.outcome;
      expect(outcome(rows.match.id)).toBe("verified");
      expect(outcome(rows.gone.id)).toBe("missing-object");
      expect(outcome(rows.shorter.id)).toBe("size-mismatch");
      expect(outcome(rows.altered.id)).toBe("checksum-mismatch");
      expect(outcome(rows.multipart.id)).toBe("verified");
      expect(report.rows.find((r) => r.id === rows.multipart.id)!.checksum).toBe("composite");
      expect(report.unreferenced.map((o) => o.key).sort()).toEqual([`derived/${stray}/manifest.json`, `files/${stray.slice(0, 2)}/${stray}.pdf`]);
      expect(report.inFlight.map((o) => o.key)).toEqual([`files/${young.slice(0, 2)}/${young}.pdf`]);
      expect(report.objectsListed).toBe(bucket.size);
      // One listing of the whole bucket, then a HEAD per listed row
      const lists = sent().filter((command) => command instanceof ListObjectsV2Command);
      expect(lists.length).toBeGreaterThan(1);
      expect(lists.every((command) => command.input.Prefix === "")).toBe(true);
      expect(sent().filter((command) => command instanceof HeadObjectCommand)).toHaveLength(6);
      expect((await statusOf(rows.gone.id)).status).toBe("stored");
      expect((await statusOf(rows.match.id)).verified_at).toBeNull();
      expect(readFileSync(files.markdown, "utf8")).toMatch(/\| Missing objects \| 1 \|/);
      expect(readFileSync(files.markdown, "utf8")).toMatch(/Read-only: nothing was written/);
      expect(readFileSync(files.csv, "utf8").split("\n")[0]).toBe("kind,file_id,key,status,outcome,expected_size,actual_size,expected_sha256,actual_sha256,checksum,last_modified");
    });

    it("applies only with a backup from the last hour, and writes nothing without one", async () => {
      const { rows } = await catalogue();
      await expect(runEbookVerification({ database, apply: true, reportDir: dir })).rejects.toThrow(/--backup FILE/);
      const old = join(dir, "old.dump");
      writeFileSync(old, "PGDMP old");
      await expect(runEbookVerification({ database, apply: true, backup: old, reportDir: dir, now: Date.now() + 2 * HOUR })).rejects.toThrow(/last hour/);
      const notADump = join(dir, "dump.sql");
      writeFileSync(notADump, "-- plain SQL");
      await expect(runEbookVerification({ database, apply: true, backup: notADump, reportDir: dir })).rejects.toThrow(/last hour/);
      expect((await c`select count(*)::int as n from ebook_files where verified_at is not null or status = 'verified'`)[0].n).toBe(1);
      expect(existsSync(join(dir, "verify"))).toBe(false);

      const backup = join(dir, "fresh.dump");
      writeFileSync(backup, "PGDMP fresh");
      const { applied } = await runEbookVerification({ database, apply: true, backup, reportDir: dir });
      expect(applied).toEqual({ verified: 3, missing: 3 });
      expect((await statusOf(rows.match.id)).status).toBe("verified");
      expect((await statusOf(rows.match.id)).verified_at).not.toBeNull();
      expect((await statusOf(rows.multipart.id)).status).toBe("verified");
      expect((await statusOf(rows.back.id)).status).toBe("verified");
      for (const row of [rows.gone, rows.shorter, rows.altered]) expect((await statusOf(row.id)).status).toBe("missing");
      // A quarantined file keeps its status: its bytes are there, but unreadable
      expect((await statusOf(rows.quarantined.id)).status).toBe("quarantined");
      // Nothing in the bucket changed
      expect(sent().every((command) => command instanceof ListObjectsV2Command || command instanceof HeadObjectCommand)).toBe(true);
    });

    it("lists an unreferenced object older than a day for the orphan report, and not a younger one", async () => {
      const now = Date.now();
      const named = await file("named");
      const objects = [
        { key: named.key, size: 5, lastModified: new Date(now - 48 * HOUR) },
        { key: `files/ab/${"ab".repeat(32)}.epub`, size: 1, lastModified: new Date(now - 25 * HOUR) },
        { key: `files/cd/${"cd".repeat(32)}.epub`, size: 1, lastModified: new Date(now - 23 * HOUR) },
        { key: `derived/${named.digest}/cover-800.webp`, size: 1, lastModified: new Date(now - 48 * HOUR) },
      ];
      const { unreferenced, inFlight } = await ebookOrphans(database, objects, now);
      expect(unreferenced.map((o) => o.key)).toEqual([`files/ab/${"ab".repeat(32)}.epub`]);
      expect(inFlight.map((o) => o.key)).toEqual([`files/cd/${"cd".repeat(32)}.epub`]);
    });
  });
});
