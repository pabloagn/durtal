import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/s3/client", async () => ({ S3_BUCKET: "local-test", s3: {
  send: (await import("./cover-stage-fixture")).catalogueSend,
} }));
vi.mock("@/lib/net/safe-fetch", () => ({ safeFetchImage: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get() { throw new Error("Owner database forbidden"); } }) }));
import { allocateCoverStage, stageCoverPair, requireVerifiedCover, renderCoverPair, retainCoverAttempt, type VerifiedCoverStage } from "@/lib/s3/cover-stage";
import { processAndUploadCover } from "@/lib/s3/covers";
import { safeFetchImage } from "@/lib/net/safe-fetch";
import { coverBucket, resetCoverBucket, realCoverBytes } from "./cover-stage-fixture";
const id = "10000000-0000-4000-8000-000000000001";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const allocate = () => allocateCoverStage({ editionId: id, source: { kind: "url", url: "https://example.com/cover.png" } });
beforeEach(() => { resetCoverBucket(); vi.clearAllMocks(); });
afterEach(() => { delete process.env.DURTAL_PREVIEW_S3_DIR; });

describe("immutable complete catalogue cover stages", () => {
  it("renders real images, verifies each complete output and allocates a fresh retry", async () => {
    const a = allocate(), b = allocate();
    expect(a.coverKey).not.toBe(b.coverKey);
    const { buffers, palette } = await renderCoverPair(await realCoverBytes());
    const stage = await stageCoverPair(a, buffers, palette);
    requireVerifiedCover(stage, id);
    for (const output of [stage.cover, stage.thumbnail]) {
      const bytes = coverBucket.objects.get(output.key)!;
      expect([output.size, output.sha256]).toEqual([bytes.length, hash(bytes)]);
    }
    expect(coverBucket.calls.map(c => c instanceof PutObjectCommand ? "put" : c instanceof GetObjectCommand ? "get" : "other")).toEqual(["put", "get", "put", "get"]);
    expect(() => requireVerifiedCover({ ...stage }, id)).toThrow("verified");
    expect(() => requireVerifiedCover(stage, "other")).toThrow("verified");
    expect(() => requireVerifiedCover(a as VerifiedCoverStage, id)).toThrow("verified");
  });
  it("adopts identical verified bytes after existing objects or lost PUT acknowledgement; rejects different bytes", async () => {
    const a = allocate(), { buffers, palette } = await renderCoverPair(await realCoverBytes());
    coverBucket.failAfter.add(a.coverKey);
    const stage = await stageCoverPair(a, buffers, palette);
    expect((await stageCoverPair(a, buffers, palette)).cover.sha256).toBe(stage.cover.sha256);
    const before = Buffer.from(coverBucket.objects.get(a.coverKey)!);
    const different = await renderCoverPair(await realCoverBytes("#ff0000"));
    await expect(stageCoverPair(a, different.buffers, different.palette)).rejects.toThrow("verification");
    expect(coverBucket.objects.get(a.coverKey)).toEqual(before);
  });
  it.each(["cover", "thumbnail"] as const)("keeps original A bytes on failed %s PUT and issues no capability", async part => {
    const oldCover = `gold/covers/${id}/cover.webp`, oldThumb = `gold/covers/${id}/thumb.webp`;
    const aBytes = await realCoverBytes(), old = await renderCoverPair(aBytes);
    coverBucket.objects.set(oldCover, old.buffers.cover); coverBucket.objects.set(oldThumb, old.buffers.thumbnail);
    const allocation = allocate();
    coverBucket.failBefore.add(part === "cover" ? allocation.coverKey : allocation.thumbnailKey);
    const b = await renderCoverPair(await realCoverBytes("#ff0000"));
    await expect(stageCoverPair(allocation, b.buffers, b.palette)).rejects.toThrow();
    expect([hash(coverBucket.objects.get(oldCover)!), hash(coverBucket.objects.get(oldThumb)!)]).toEqual([hash(old.buffers.cover), hash(old.buffers.thumbnail)]);
    expect(retainCoverAttempt(allocation, "partial or unknown outcome")).toMatchObject({ cleanupPending: true, keys: [allocation.coverKey, allocation.thumbnailKey] });
    expect(coverBucket.calls.some(c => c instanceof DeleteObjectCommand || c instanceof DeleteObjectsCommand)).toBe(false);
  });
  it("refuses nominal successful PUT whose read-back bytes differ", async () => {
    const a = allocate(), image = await renderCoverPair(await realCoverBytes());
    coverBucket.corruptReads.add(a.coverKey);
    await expect(stageCoverPair(a, image.buffers, image.palette)).rejects.toThrow("verification");
    expect(coverBucket.objects.has(a.thumbnailKey)).toBe(false);
  });
  it("URL writer preserves safe fetch and never targets deterministic old keys", async () => {
    const bytes = await realCoverBytes();
    vi.mocked(safeFetchImage).mockResolvedValue({ buffer: bytes, contentType: "image/png", finalUrl: "https://example.com/cover.png" } as Awaited<ReturnType<typeof safeFetchImage>>);
    const a = await processAndUploadCover(id, "https://example.com/cover.png");
    const b = await processAndUploadCover(id, "https://example.com/cover.png");
    expect(safeFetchImage).toHaveBeenCalledWith("https://example.com/cover.png", { allowHttp: true });
    expect(a?.coverKey).not.toBe(b?.coverKey);
    expect(coverBucket.objects.has(`gold/covers/${id}/cover.webp`)).toBe(false);
  });
  it("exclusive preview creation never truncates an existing pair, including concurrent same-identity writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "durtal-cover-stage-"));
    process.env.DURTAL_PREVIEW_S3_DIR = dir;
    try {
      const a = allocate(), image = await renderCoverPair(await realCoverBytes());
      const outcomes = await Promise.allSettled([stageCoverPair(a, image.buffers, image.palette), stageCoverPair(a, image.buffers, image.palette)]);
      expect(outcomes.some(outcome => outcome.status === "fulfilled")).toBe(true);
      expect((await stageCoverPair(a, image.buffers, image.palette)).cover.sha256).toBe(hash(image.buffers.cover));
      const before = await readFile(join(dir, a.coverKey));
      const other = await renderCoverPair(await realCoverBytes("#ff0000"));
      await expect(stageCoverPair(a, other.buffers, other.palette)).rejects.toThrow();
      expect(await readFile(join(dir, a.coverKey))).toEqual(before);
      expect(coverBucket.calls).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
