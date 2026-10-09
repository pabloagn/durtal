import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEpub, makePdf, makeCorruptZip, makeImage, encryptionXml } from "../fixtures/ebook-builders";
import { prepareFile, derivedCachePath } from "@/lib/ebooks/ingest/prepare";
import { bytesSource } from "@/lib/ebooks/ingest/source";
import { hashBytes, stageFile } from "@/lib/ebooks/medallion";
import { validateStagePlan, verifyPublication } from "@/lib/ebooks/publication";
import { parseStageKey, isDeliveryFileKey, derivedKeyForWidth } from "@/lib/ebooks/keys";
import { putEbookObject, getEbookObjectRange } from "@/lib/ebooks/storage";
import { isDeliverable } from "@/lib/ebooks/delivery/files";
import type { EbookFormat } from "@/lib/ebooks/formats";
import type { PlanFile } from "@/lib/ebooks/ingest/plan";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "durtal-medallion-"));
  vi.stubEnv("DURTAL_PREVIEW_S3_DIR", path.join(dir, "s3"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
async function staged(bytes: Uint8Array, format: EbookFormat) {
  const prepared = await prepareFile(bytesSource(bytes, `book.${format}`), hashBytes(bytes), format, dir);
  const stage = stageFile(prepared, prepared.metadata as Record<string, unknown>, readFileSync(derivedCachePath(dir, prepared.sha256, "manifest.json")));
  const file: PlanFile = {
    path: "book",
    size: bytes.length,
    mtimeMs: 0,
    sha256: prepared.sha256,
    format,
    contentType: prepared.contentType,
    key: stage.key,
    medallion: stage.medallion,
    originalFilename: `book.${format}`,
    downloadName: `book.${format}`,
    drm: prepared.drm,
    problem: stage.medallion.validation.reason,
    metadata: { medallion: stage.medallion },
    text: prepared.text,
    derived: stage.derived,
    manifestKey: stage.derived.find((d) => d.name === "manifest.json")?.key ?? null,
    coverKey: stage.derived.find((d) => d.name === "cover-800.webp")?.key ?? null,
  };
  return { prepared, stage, file, bytes };
}
async function store(value: Awaited<ReturnType<typeof staged>>, marker = true) {
  const { stage, prepared, bytes } = value;
  await putEbookObject({
    key: stage.medallion.bronze.key,
    body: bytes,
    contentType: prepared.contentType,
  });
  await putEbookObject({
    key: stage.medallion.silver.key,
    body: Buffer.from(stage.report),
    contentType: "application/json",
  });
  if (!stage.medallion.validation.downloadable) return;
  await putEbookObject({
    key: stage.key,
    body: bytes,
    contentType: prepared.contentType,
  });
  for (const object of stage.derived) {
    if (!marker && object.name === "manifest.json") continue;
    const body = object.name === "manifest.json" ? Buffer.from(stage.publication) : readFileSync(derivedCachePath(dir, prepared.sha256, object.name));
    await putEbookObject({
      key: object.key,
      body,
      contentType: object.contentType,
    });
  }
}
describe("medallion publication", () => {
  it("verifies EPUB and PDF lineage, source bytes, gold download and explicit byte ranges", async () => {
    for (const [format, bytes] of [
      ["epub", makeEpub()],
      ["pdf", makePdf()],
    ] as [EbookFormat, Uint8Array][]) {
      const value = await staged(bytes, format);
      validateStagePlan(value.file);
      await store(value);
      const reordered = JSON.parse(JSON.stringify(value.file.metadata), (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value,
      );
      expect(await verifyPublication(reordered)).toBeNull();
      expect(value.stage.medallion.validation.nativeReadable).toBe(true);
      for (const key of [value.stage.medallion.bronze.key, value.stage.key]) {
        const object = await getEbookObjectRange(key, 0);
        expect(hashBytes(new Uint8Array(await new Response(object!.body).arrayBuffer()))).toBe(hashBytes(bytes));
        const slice = await getEbookObjectRange(key, 5, 20);
        expect(new Uint8Array(await new Response(slice!.body).arrayBuffer())).toEqual(bytes.subarray(5, 21));
      }
    }
  });
  it("keeps DRM, damaged, Topaz and unknown-validation formats out of gold", async () => {
    const drm = makeEpub({
      entries: [
        {
          name: "META-INF/encryption.xml",
          data: encryptionXml([{ uri: "OEBPS/c1.xhtml", algorithm: "unknown" }]),
        },
      ],
    });
    for (const [format, bytes] of [
      ["epub", drm],
      ["epub", makeCorruptZip()],
      ["azw", Buffer.from("TPZunsupported")],
      ["cbr", Buffer.from("Rar!unsupported")],
    ] as [EbookFormat, Uint8Array][]) {
      const value = await staged(bytes, format);
      expect(value.stage.medallion.validation.downloadable).toBe(false);
      expect(value.stage.medallion.gold).toEqual([]);
      expect(value.file.derived).toEqual([]);
      validateStagePlan(value.file);
      await store(value);
      expect(await verifyPublication(value.file.metadata)).toBeNull();
      expect(
        isDeliverable({
          status: "stored",
          drm: null,
          sha256: value.file.sha256,
          format,
          s3Key: value.file.key,
          metadata: value.file.metadata,
        }),
      ).toBe(false);
    }
  });
  it("offers verified text as a download without claiming native-reader support", async () => {
    const value = await staged(Buffer.from("A plain UTF-8 book."), "txt");
    expect(value.stage.medallion.validation).toMatchObject({
      downloadable: true,
      nativeReadable: false,
    });
    await store(value);
    expect(await verifyPublication(value.file.metadata)).toBeNull();
  });
  it("fails incomplete publications and detects corruption in a nonpreferred cover width", async () => {
    const value = await staged(makeEpub({ cover: await makeImage("png") }), "epub");
    await store(value, false);
    expect(await verifyPublication(value.file.metadata)).toMatch(/missing|differs/);
    await store(value);
    expect(await verifyPublication(value.file.metadata)).toBeNull();
    const key = value.stage.derived.find((d) => d.name === "cover-240.webp")!.key;
    const target = path.join(dir, "s3", "durtal", key);
    writeFileSync(target, "corrupt");
    expect(await verifyPublication(value.file.metadata)).toMatch(/missing|differs/);
  });
  it("creates immutable reprocessing identities while retaining the same gold file", async () => {
    const value = await staged(makeEpub(), "epub");
    const next = stageFile(
      { ...value.prepared, version: value.prepared.version + 1 },
      { title: "Corrected title" },
      readFileSync(derivedCachePath(dir, value.prepared.sha256, "manifest.json")),
    );
    expect(next.key).toBe(value.stage.key);
    expect(next.medallion.silver.key).not.toBe(value.stage.medallion.silver.key);
    expect(next.derived.at(-1)!.key).not.toBe(value.stage.derived.at(-1)!.key);
    await store(value);
    await expect(
      putEbookObject({
        key: value.stage.medallion.silver.key,
        body: Buffer.from("other report"),
        contentType: "application/json",
      }),
    ).rejects.toThrow(/differs/);
  });
  it("rejects false-gold plans and noncanonical delivery keys while retaining legacy originals", async () => {
    const value = await staged(makeEpub(), "epub");
    expect(isDeliveryFileKey(value.file.key, value.file.sha256, "epub")).toBe(true);
    expect(isDeliveryFileKey(value.stage.medallion.bronze.key, value.file.sha256, "epub")).toBe(false);
    expect(isDeliveryFileKey(`files/${value.file.sha256.slice(0, 2)}/${value.file.sha256}.epub`, value.file.sha256, "epub")).toBe(true);
    expect(parseStageKey(value.file.key.replace(value.file.sha256.slice(0, 2), "zz"))).toBeNull();
    expect(isDeliverable({ status: "stored", drm: null, sha256: value.file.sha256, format: "epub", s3Key: value.file.key, metadata: value.file.metadata })).toBe(true);
    expect(
      isDeliverable({
        status: "stored",
        drm: null,
        sha256: value.file.sha256,
        format: "epub",
        s3Key: value.file.key,
        metadata: { medallion: { ...value.stage.medallion, gold: [] } },
      }),
    ).toBe(false);
    for (const key of [value.stage.medallion.silver.key, `gold/media/${value.file.sha256}.epub`, `bronze/media/${value.file.sha256}.epub`])
      expect(isDeliveryFileKey(key, value.file.sha256, "epub")).toBe(false);
    const bad = structuredClone(value.file);
    bad.medallion!.validation.integrity = "unverified";
    expect(() => validateStagePlan(bad)).toThrow();
    expect(derivedKeyForWidth(value.stage.derived.at(-1)!.key, 400)).toBeNull();
  });
});
