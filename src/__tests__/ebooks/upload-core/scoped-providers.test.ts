import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeadObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { checkEbookStorageScope, type EbookStorageScope } from "@/lib/ebooks/storage";
import { verifyPublication } from "@/lib/ebooks/publication";
import { storeObject } from "@/lib/ebooks/ingest/store";
import { hashBytes, stageFile, validationFor } from "@/lib/ebooks/medallion";
import type { PreparedFile } from "@/lib/ebooks/ingest/prepare";

const mock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/s3/preview-dir", () => ({ previewS3Dir: () => null }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ EBOOKS_BUCKET: "fixture-bucket", EBOOKS_PREFIX: "ebooks/",
  EBOOKS_REGION: "fixture-region", AWS_ACCESS_KEY_ID: "fixture-access", AWS_SECRET_ACCESS_KEY: "fixture-secret" }) }));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...await original<typeof import("@aws-sdk/client-s3")>(), S3Client: class { send = mock.send; },
}));

// Actual storage, scoped publisher and verifier imports. Only the external SDK
// transport and configuration edges are mocked; no provider replacement exists.
const bytes = Buffer.from("abc");
function fixture() {
  const sha256 = hashBytes(bytes), manifest = Buffer.from(JSON.stringify({ version: 1, format: "epub", sha256 }));
  const prepared: PreparedFile = { version: 2, sha256, size: bytes.length, format: "epub", contentType: "application/epub+zip",
    validation: validationFor("epub", null, null, true), drm: null, problem: null, metadata: { title: "Book" }, details: {},
    text: { wordCount: 1, charCount: 3, frontBackWordCount: null, pageEstimate: 1, language: "en", toolVersion: 1, reason: null },
    coverReason: null, opfUuid: null, derived: [{ name: "manifest.json", size: manifest.length, sha256: hashBytes(manifest), contentType: "application/json" }] };
  const publication = stageFile(prepared, { title: "Book" }, manifest);
  const objects = new Map<string, Buffer>([
    [publication.medallion.bronze.key, bytes], [publication.medallion.silver.key, Buffer.from(publication.report)],
    [publication.medallion.gold[0].key, bytes], [publication.derived[0].key, Buffer.from(publication.publication)],
  ]);
  mock.send.mockImplementation(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      objects.set(command.input.Key!, Buffer.from(command.input.Body as Uint8Array)); return {};
    }
    if (!(command instanceof HeadObjectCommand || command instanceof GetObjectCommand)) throw new Error("Unexpected SDK edge");
    const body = objects.get(command.input.Key!);
    if (!body) throw Object.assign(new Error("Missing object"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    if (command instanceof HeadObjectCommand) return { ContentLength: body.length,
      ChecksumSHA256: Buffer.from(hashBytes(body), "hex").toString("base64"), ChecksumType: "FULL_OBJECT" };
    return { ContentLength: body.length, Body: { transformToWebStream: () => new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(body); controller.close(); },
    }) } };
  });
  const abort = new AbortController(), current = vi.fn(async () => {});
  const scope: EbookStorageScope = { signal: abort.signal, current };
  return { publication, objects, abort, current, scope };
}
describe("real scoped storage and publication provider graph", () => {
  beforeEach(() => vi.clearAllMocks());
  it("verifies actual staged bytes and propagates the job signal through real HEAD and evidence reads", async () => {
    const f = fixture();
    expect(await verifyPublication({ medallion: f.publication.medallion }, f.scope)).toBeNull();
    expect(mock.send.mock.calls.some(([command]) => command instanceof GetObjectCommand)).toBe(true);
    expect(mock.send.mock.calls.every((call) => call[1].abortSignal === f.abort.signal)).toBe(true);
    expect(f.current).toHaveBeenCalled();
  });
  it("propagates cancellation after a storage response instead of verifying or swallowing it", async () => {
    const f = fixture(), send = mock.send.getMockImplementation()!;
    mock.send.mockImplementation(async (command, options) => {
      const result = await send(command, options); f.abort.abort(new Error("Job canceled")); return result;
    });
    await expect(verifyPublication({ medallion: f.publication.medallion }, f.scope)).rejects.toThrow("Job canceled");
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
  it("refuses a lost current lease before any object verification call", async () => {
    const f = fixture(); f.current.mockRejectedValue(new Error("Lease lost"));
    await expect(checkEbookStorageScope(f.scope)).rejects.toThrow("Lease lost");
    await expect(verifyPublication({ medallion: f.publication.medallion }, f.scope)).rejects.toThrow("Lease lost");
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("the actual publisher uses the real scoped provider for both initial and final HEAD around PUT", async () => {
    const f = fixture(), object = f.publication.medallion.bronze; f.objects.delete(object.key);
    const multipartState = { read: vi.fn(async () => null), write: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
    const result = await storeObject({ ...object, body: { bytes } }, { cacheDir: "/unused-no-local-custody", scope: f.scope, multipartState });
    expect(result).toEqual({ adopted: false, multipart: false });
    expect(mock.send.mock.calls.map(([command]) => command.constructor)).toEqual([HeadObjectCommand, PutObjectCommand, HeadObjectCommand]);
    expect(mock.send.mock.calls.every((call) => call[1].abortSignal === f.abort.signal)).toBe(true);
    expect(multipartState.write).not.toHaveBeenCalled();
  });
});
