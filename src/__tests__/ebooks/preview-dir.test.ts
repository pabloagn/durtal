import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { getEbookObjectRange, headEbookObject, listEbookObjects, putEbookObject } from "@/lib/ebooks/storage";
import { ebookDerivedKey, ebookFileKey } from "@/lib/ebooks/keys";

/* SLN-491: the e-book bucket in a preview's folder, DIR/<bucket>/<key> */

const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);
const sha = createHash("sha256").update(bytes).digest("hex");
let dir: string;
let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "durtal-ebook-s3-"));
  vi.stubEnv("DURTAL_PREVIEW_S3_DIR", dir);
  send = vi.spyOn(S3Client.prototype, "send");
});
afterEach(() => {
  expect(send).not.toHaveBeenCalled();
  send.mockRestore();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const text = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());

describe("the e-book bucket in a preview's folder", () => {
  it("writes under DIR/<bucket>/<key>, and never overwrites a file", async () => {
    const key = ebookFileKey(sha, "epub");
    expect(await putEbookObject({ key, body: bytes, contentType: "application/epub+zip" })).toEqual({ created: true, sha256: sha });
    expect(new Uint8Array(readFileSync(join(dir, "durtal-ebooks", key)))).toEqual(bytes);
    expect((await putEbookObject({ key, body: bytes, contentType: "application/epub+zip" })).created).toBe(false);
  });

  it("refuses a file whose key is not the checksum of its bytes", async () => {
    await expect(putEbookObject({ key: ebookFileKey("00".repeat(32), "epub"), body: bytes, contentType: "x" })).rejects.toThrow(/checksum of its bytes/);
    await expect(putEbookObject({ key: "gold/covers/x.webp", body: bytes, contentType: "x" })).rejects.toThrow(/Not a key of the e-book bucket/);
  });

  it("reads exactly the slice a range asks for", async () => {
    const key = ebookFileKey(sha, "pdf");
    await putEbookObject({ key, body: bytes, contentType: "application/pdf" });
    const range = (await getEbookObjectRange(key, 100, 1123))!;
    expect(range.length).toBe(1024);
    expect(await text(range.body)).toEqual(bytes.slice(100, 1124));
    const tail = (await getEbookObjectRange(key, 4990))!;
    expect(await text(tail.body)).toEqual(bytes.slice(4990));
    expect((await getEbookObjectRange(key, 4990, 99999))!.length).toBe(10);
    expect(await getEbookObjectRange(key, 5000, 5001)).toBeNull();
    expect(await getEbookObjectRange(ebookFileKey("11".repeat(32), "pdf"), 0, 1)).toBeNull();
  });

  it("heads an object with its size and SHA-256, and lists a prefix", async () => {
    const key = ebookFileKey(sha, "epub");
    await putEbookObject({ key, body: bytes, contentType: "application/epub+zip" });
    await putEbookObject({ key: ebookDerivedKey(sha, "manifest.json"), body: new TextEncoder().encode("{}"), contentType: "application/json" });
    expect(await headEbookObject(key, { checksum: true })).toMatchObject({ size: 5000, sha256: sha, checksumType: "full" });
    expect(await headEbookObject(ebookFileKey("22".repeat(32), "epub"))).toBeNull();
    expect((await listEbookObjects("files/")).map((o) => [o.key, o.size])).toEqual([[key, 5000]]);
    expect((await listEbookObjects("")).length).toBe(2);
  });

  it("refuses .. in a key", async () => {
    await expect(getEbookObjectRange("files/../../outside", 0, 1)).rejects.toThrow(/leaves the preview folder/);
    await expect(headEbookObject("derived/../../../etc/passwd")).rejects.toThrow(/leaves the preview folder/);
    expect(existsSync(join(dir, "outside"))).toBe(false);
  });
});
