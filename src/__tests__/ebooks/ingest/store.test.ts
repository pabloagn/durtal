import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { compositeChecksum, PART_SIZE, RETRY_DELAYS_MS, SINGLE_PUT_MAX, storeObject, type StoreInput } from "@/lib/ebooks/ingest/store";
import { sha256File } from "@/lib/ebooks/ingest/hash";
import { ebookFileKey } from "@/lib/ebooks/keys";

/*
 * SLN-494: storing one object. S3 is a fake that checks what real S3 checks:
 * a PUT's SHA-256 against its bytes, IfNoneMatch against the key, each
 * part's SHA-256, and a completed upload's composite checksum.
 */

interface Stored {
  size: number;
  checksum: string;
  composite: boolean;
  metadata: Record<string, string>;
  bytes?: Uint8Array;
}

const httpError = (name: string, status: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();

async function bodyBytes(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

let objects: Map<string, Stored>;
let uploads: Map<string, { key: string; metadata: Record<string, string>; parts: Map<number, { size: number; checksum: string }> }>;
let calls: { name: string; input: Record<string, unknown> }[];
/** Runs before each command; a test makes it throw to fail one */
let before: (name: string, input: Record<string, unknown>) => void;
let send: ReturnType<typeof vi.spyOn>;
let dir: string;

beforeEach(() => {
  objects = new Map();
  uploads = new Map();
  calls = [];
  before = () => {};
  dir = mkdtempSync(path.join(tmpdir(), "durtal-store-"));
  send = vi.spyOn(S3Client.prototype, "send").mockImplementation((async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = command.constructor.name.replace(/Command$/, "");
    const input = command.input;
    calls.push({ name, input });
    before(name, input);
    const key = input.Key as string;
    if (command instanceof HeadObjectCommand) {
      const object = objects.get(key);
      if (!object) throw httpError("NotFound", 404);
      return {
        ContentLength: object.size,
        ChecksumSHA256: input.ChecksumMode === "ENABLED" ? object.checksum : undefined,
        ChecksumType: object.composite ? "COMPOSITE" : "FULL_OBJECT",
        Metadata: object.metadata,
      };
    }
    if (command instanceof GetObjectCommand) {
      const object = objects.get(key);
      if (!object?.bytes) throw httpError("NotFound", 404);
      return {
        ContentLength: object.bytes.length,
        Body: {
          transformToWebStream: () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(object.bytes);
                controller.close();
              },
            }),
        },
      };
    }
    if (command instanceof PutObjectCommand) {
      if (input.IfNoneMatch === "*" && objects.has(key)) throw httpError("PreconditionFailed", 412);
      const bytes = await bodyBytes(input.Body);
      const checksum = sha256(bytes).toString("base64");
      if (input.ChecksumSHA256 && input.ChecksumSHA256 !== checksum) throw httpError("BadDigest", 400);
      objects.set(key, { size: bytes.length, checksum, composite: false, metadata: (input.Metadata as Record<string, string>) ?? {} });
      return { ChecksumSHA256: checksum };
    }
    if (command instanceof CreateMultipartUploadCommand) {
      const id = `upload-${uploads.size + 1}`;
      // As S3 does: the metadata given here is the completed object's
      uploads.set(id, { key, metadata: (input.Metadata as Record<string, string>) ?? {}, parts: new Map() });
      return { UploadId: id };
    }
    if (command instanceof UploadPartCommand) {
      const upload = uploads.get(input.UploadId as string);
      if (!upload) throw httpError("NoSuchUpload", 404);
      const bytes = await bodyBytes(input.Body);
      const checksum = sha256(bytes).toString("base64");
      if (input.ChecksumSHA256 !== checksum) throw httpError("BadDigest", 400);
      upload.parts.set(input.PartNumber as number, { size: bytes.length, checksum });
      return { ETag: `"etag-${input.PartNumber}"`, ChecksumSHA256: checksum };
    }
    if (command instanceof ListPartsCommand) {
      const upload = uploads.get(input.UploadId as string);
      if (!upload) throw httpError("NoSuchUpload", 404);
      const parts = [...upload.parts].sort(([a], [b]) => a - b);
      return { Parts: parts.map(([n, p]) => ({ PartNumber: n, ETag: `"etag-${n}"`, ChecksumSHA256: p.checksum, Size: p.size })), IsTruncated: false };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      const upload = uploads.get(input.UploadId as string);
      if (!upload) throw httpError("NoSuchUpload", 404);
      if (input.IfNoneMatch === "*" && objects.has(key)) throw httpError("PreconditionFailed", 412);
      const listed = (input.MultipartUpload as { Parts: { PartNumber: number; ChecksumSHA256: string }[] }).Parts;
      const outer = createHash("sha256");
      let size = 0;
      for (const part of listed) {
        const stored = upload.parts.get(part.PartNumber);
        if (!stored || stored.checksum !== part.ChecksumSHA256) throw httpError("InvalidPart", 400);
        outer.update(Buffer.from(stored.checksum, "base64"));
        size += stored.size;
      }
      objects.set(key, { size, checksum: `${outer.digest("base64")}-${listed.length}`, composite: true, metadata: upload.metadata });
      uploads.delete(input.UploadId as string);
      return {};
    }
    if (command instanceof AbortMultipartUploadCommand) {
      uploads.delete(input.UploadId as string);
      return {};
    }
    throw new Error(`Unexpected S3 command ${name}`);
  }) as never);
});

afterEach(() => {
  send.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

const noSleep = vi.fn(async () => {});

function bytesInput(bytes: Uint8Array): StoreInput {
  const hex = sha256(bytes).toString("hex");
  return { key: ebookFileKey(hex, "epub"), sha256: hex, size: bytes.length, contentType: "application/epub+zip", filename: "A Book.epub", body: { bytes } };
}

const names = () => calls.map((c) => c.name);

describe("storeObject, one PUT", () => {
  const bytes = new TextEncoder().encode("PK an e-book's bytes");

  it("adopts an object already there with the same size and checksum, and uploads nothing", async () => {
    const input = bytesInput(bytes);
    objects.set(input.key, { size: bytes.length, checksum: sha256(bytes).toString("base64"), composite: false, metadata: {} });
    expect(await storeObject(input, { cacheDir: dir, sleep: noSleep })).toEqual({ adopted: true, multipart: false });
    expect(names()).toEqual(["HeadObject"]);
    expect(calls[0].input.ChecksumMode).toBe("ENABLED");
  });

  it("sends ChecksumSHA256 and IfNoneMatch with the object's headers, then verifies with a HEAD", async () => {
    const input = bytesInput(bytes);
    expect(await storeObject(input, { cacheDir: dir, sleep: noSleep })).toEqual({ adopted: false, multipart: false });
    expect(names()).toEqual(["HeadObject", "PutObject", "HeadObject"]);
    expect(calls[1].input).toMatchObject({
      Key: input.key,
      ChecksumSHA256: sha256(bytes).toString("base64"),
      IfNoneMatch: "*",
      ContentLength: bytes.length,
      ContentType: "application/epub+zip",
      CacheControl: "public, max-age=31536000, immutable",
      ContentDisposition: "inline; filename*=UTF-8''A%20Book.epub",
      Metadata: { sha256: input.sha256 },
      StorageClass: "INTELLIGENT_TIERING",
      ServerSideEncryption: "AES256",
    });
  });

  it("verifies a 412 like any other write: the key exists, so the bytes are the same", async () => {
    const input = bytesInput(bytes);
    let heads = 0;
    // Another writer stores the object between the first HEAD and the PUT
    before = (name) => {
      if (name === "HeadObject" && heads++ === 0) return;
      if (name === "PutObject") objects.set(input.key, { size: bytes.length, checksum: sha256(bytes).toString("base64"), composite: false, metadata: {} });
    };
    expect(await storeObject(input, { cacheDir: dir, sleep: noSleep })).toEqual({ adopted: false, multipart: false });
    expect(names()).toEqual(["HeadObject", "PutObject", "HeadObject"]);
  });

  it("fails when the object already there differs in size or checksum", async () => {
    const input = bytesInput(bytes);
    objects.set(input.key, { size: bytes.length + 1, checksum: "x", composite: false, metadata: {} });
    await expect(storeObject(input, { cacheDir: dir, sleep: noSleep })).rejects.toThrow(/differs from the file: its size is/);
    objects.set(input.key, { size: bytes.length, checksum: sha256(new Uint8Array([1])).toString("base64"), composite: false, metadata: {} });
    await expect(storeObject(input, { cacheDir: dir, sleep: noSleep })).rejects.toThrow(/its SHA-256 differs/);
    expect(names()).not.toContain("PutObject");
  });

  it("fails the item when the final HEAD finds other bytes", async () => {
    const input = bytesInput(bytes);
    before = (name) => {
      // S3 answers the PUT, but what it then holds is not what was sent
      if (name === "HeadObject" && objects.has(input.key)) objects.get(input.key)!.size = 3;
    };
    await expect(storeObject(input, { cacheDir: dir, sleep: noSleep })).rejects.toThrow(`The stored object ${input.key} differs from the file: its size is 3 bytes`);
  });

  it("retries a 503 with backoff, then succeeds; a 403 is not retried", async () => {
    const input = bytesInput(bytes);
    let puts = 0;
    before = (name) => {
      if (name === "PutObject" && puts++ < 2) throw httpError("ServiceUnavailable", 503);
    };
    const sleep = vi.fn(async (ms: number) => void ms);
    expect(await storeObject(input, { cacheDir: dir, sleep })).toEqual({ adopted: false, multipart: false });
    expect(puts).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(RETRY_DELAYS_MS.slice(0, 2));

    objects.clear();
    before = (name) => {
      if (name === "PutObject") throw httpError("AccessDenied", 403);
    };
    sleep.mockClear();
    await expect(storeObject(input, { cacheDir: dir, sleep })).rejects.toThrow("AccessDenied");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the third retry", async () => {
    before = (name) => {
      if (name === "PutObject") throw httpError("SlowDown", 503);
    };
    const sleep = vi.fn(async (ms: number) => void ms);
    await expect(storeObject(bytesInput(bytes), { cacheDir: dir, sleep })).rejects.toThrow("SlowDown");
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(RETRY_DELAYS_MS);
  });

  it("streams a file body, opening a new stream for a retried PUT", async () => {
    const file = path.join(dir, "book.epub");
    const handle = openSync(file, "w");
    writeSync(handle, Buffer.from(bytes));
    closeSync(handle);
    let puts = 0;
    before = (name) => {
      if (name === "PutObject" && puts++ === 0) throw httpError("InternalError", 500);
    };
    const input = { ...bytesInput(bytes), body: { file } };
    expect(await storeObject(input, { cacheDir: dir, sleep: noSleep })).toEqual({ adopted: false, multipart: false });
    expect(objects.get(input.key)).toMatchObject({ size: bytes.length, checksum: sha256(bytes).toString("base64") });
  });
});

describe("storeObject, multipart", () => {
  it("sends a 300 MiB file in 16 MiB parts, resumes from the saved parts after a crash, and checks the composite checksum", { timeout: 120_000 }, async () => {
    expect(SINGLE_PUT_MAX).toBe(256 * 1024 * 1024);
    expect(PART_SIZE).toBe(16 * 1024 * 1024);
    const file = path.join(dir, "large.pdf");
    const handle = openSync(file, "w");
    const mib = Buffer.alloc(1024 * 1024);
    for (let n = 0; n < 300; n++) {
      mib.fill(n % 251);
      mib.writeUInt32BE(n, 0);
      writeSync(handle, mib);
    }
    closeSync(handle);
    const size = 300 * 1024 * 1024;
    const hex = await sha256File(file);
    const input: StoreInput = { key: ebookFileKey(hex, "pdf"), sha256: hex, size, contentType: "application/pdf", body: { file } };
    const cacheDir = path.join(dir, "cache");
    const parts = Math.ceil(size / PART_SIZE);
    expect(parts).toBe(19);

    // The machine stops after the 7th part
    let sent = 0;
    before = (name) => {
      if (name === "UploadPart" && ++sent === 8) throw Object.assign(new Error("The process was stopped"), { name: "AbortError" });
    };
    await expect(storeObject(input, { cacheDir, sleep: noSleep })).rejects.toThrow("The process was stopped");
    expect(readdirSync(path.join(cacheDir, "uploads"))).toHaveLength(1);
    expect(readdirSync(path.join(cacheDir, "uploads"))[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(calls.find((c) => c.name === "CreateMultipartUpload")?.input).toMatchObject({ ChecksumAlgorithm: "SHA256", Metadata: { sha256: hex }, StorageClass: "INTELLIGENT_TIERING",
    });

    // The restart lists the 7 parts S3 has and sends only the other 12
    calls = [];
    before = () => {};
    expect(await storeObject(input, { cacheDir, sleep: noSleep })).toEqual({ adopted: false, multipart: true });
    expect(names().filter((n) => n === "CreateMultipartUpload")).toEqual([]);
    expect(names()).toContain("ListParts");
    const uploaded = calls.filter((c) => c.name === "UploadPart").map((c) => c.input.PartNumber);
    expect(uploaded).toEqual(Array.from({ length: parts - 7 }, (_, i) => i + 8));
    expect(calls.find((c) => c.name === "CompleteMultipartUpload")?.input).toMatchObject({ IfNoneMatch: "*" });
    expect(existsSync(path.join(cacheDir, "uploads", `${hex}.json`))).toBe(false);

    // The object holds the composite checksum, which matches the one computed here
    const stored = objects.get(input.key)!;
    expect(stored).toMatchObject({ size, composite: true });
    expect(stored.checksum).toBe(await compositeChecksum(input.body, size));
    expect(stored.checksum).toMatch(/-19$/);
  });

  it("starts again when the saved upload is gone from S3", async () => {
    const bytes = new Uint8Array(40).map((_, i) => i);
    const input = bytesInput(bytes);
    const options = { cacheDir: dir, sleep: noSleep, singlePutMax: 16, partSize: 16 };
    let sent = 0;
    before = (name) => {
      if (name === "UploadPart" && ++sent === 2) throw new Error("stopped");
    };
    await expect(storeObject(input, options)).rejects.toThrow("stopped");
    uploads.clear(); // the bucket's lifecycle rule aborted it
    calls = [];
    before = () => {};
    expect(await storeObject(input, options)).toEqual({ adopted: false, multipart: true });
    expect(names().filter((n) => n === "UploadPart")).toHaveLength(3);
    expect(names()).toContain("CreateMultipartUpload");
  });

  it("drops its upload on a 412 at completion and verifies the object another upload stored", async () => {
    const bytes = new Uint8Array(40).map((_, i) => i * 3);
    const input = bytesInput(bytes);
    const options = { cacheDir: dir, sleep: noSleep, singlePutMax: 16, partSize: 16 };
    const composite = await compositeChecksum(input.body, bytes.length, 16);
    before = (name) => {
      if (name === "CompleteMultipartUpload") objects.set(input.key, { size: bytes.length, checksum: composite, composite: true, metadata: { sha256: input.sha256 } });
    };
    expect(await storeObject(input, options)).toEqual({ adopted: false, multipart: true });
    expect(names().slice(-2)).toEqual(["AbortMultipartUpload", "HeadObject"]);
  });

  it("refuses a file whose bytes changed since the plan, before completing: the upload is aborted, nothing is stored", async () => {
    const planned = new Uint8Array(40).map((_, i) => i * 7);
    const file = path.join(dir, "changed.pdf");
    const handle = openSync(file, "w");
    writeSync(handle, Buffer.from(new Uint8Array(40).map((_, i) => i * 11))); // the same size, other bytes
    closeSync(handle);
    const input = { ...bytesInput(planned), body: { file } };
    await expect(storeObject(input, { cacheDir: dir, sleep: noSleep, singlePutMax: 16, partSize: 16 })).rejects.toThrow(/differs from the file: the bytes sent are not the planned SHA-256/,
    );
    expect(names()).not.toContain("CompleteMultipartUpload");
    expect(names()).toContain("AbortMultipartUpload");
    expect(objects.has(input.key)).toBe(false);
    expect(uploads.size).toBe(0);
    expect(readdirSync(path.join(dir, "uploads"))).toEqual([]);

    // The same file in one PUT: S3 itself refuses the checksum
    await expect(storeObject(input, { cacheDir: dir, sleep: noSleep })).rejects.toThrow("BadDigest");
  });

  it("checks its own upload by the parts sent, never by the sha256 metadata it wrote itself", async () => {
    const bytes = new Uint8Array(40).map((_, i) => i * 9);
    const input = bytesInput(bytes);
    before = (name) => {
      // S3 completes the upload, but the object it then holds is other parts; the metadata still names the plan
      if (name === "HeadObject" && objects.has(input.key)) objects.get(input.key)!.checksum = "b3RoZXIgcGFydHM=-3";
    };
    await expect(storeObject(input, { cacheDir: dir, sleep: noSleep, singlePutMax: 16, partSize: 16 })).rejects.toThrow(/its multipart checksum is not the parts sent/);
    expect(objects.get(input.key)?.metadata).toEqual({ sha256: input.sha256 });
  });

  it("streams and hashes an adopted multipart object with other part sizes; metadata alone is insufficient", async () => {
    const bytes = new Uint8Array(40).map((_, i) => i * 5);
    const input = bytesInput(bytes);
    objects.set(input.key, { size: bytes.length, checksum: "c29tZXRoaW5nIGVsc2U=-2", composite: true, metadata: { sha256: input.sha256 }, bytes });
    expect(await storeObject(input, { cacheDir: dir, sleep: noSleep, singlePutMax: 16, partSize: 16 })).toEqual({ adopted: true, multipart: false });
    objects.set(input.key, { size: bytes.length, checksum: "c29tZXRoaW5nIGVsc2U=-2", composite: true, metadata: { sha256: input.sha256 }, bytes: new Uint8Array(bytes.length) });
    await expect(storeObject(input, { cacheDir: dir, sleep: noSleep, singlePutMax: 16, partSize: 16 })).rejects.toThrow(/its multipart checksum differs/);
  });
});
