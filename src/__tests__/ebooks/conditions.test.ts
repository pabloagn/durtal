import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEbookFileDownloadable,
  isEbookFileNativeReadable,
  type EbookFileEligibility,
} from "@/lib/ebooks/conditions";
import { ebookFileKey, ebookGoldFileKey } from "@/lib/ebooks/keys";
import { MEDALLION_VERSION } from "@/lib/ebooks/medallion";

const sha = "ab".repeat(32);
const key = ebookGoldFileKey(sha, "epub");
const object = {
  key,
  sha256: sha,
  size: 200,
  contentType: "application/epub+zip",
};
const metadata = {
  medallion: {
    version: MEDALLION_VERSION,
    bronze: object,
    silver: object,
    validation: {
      integrity: "verified",
      drm: "clear",
      downloadable: true,
      nativeReadable: true,
      reason: null,
    },
    gold: [object],
  },
};
const file: EbookFileEligibility = {
  sha256: sha,
  s3Key: key,
  status: "stored",
  drm: null,
  format: "epub",
  metadata,
};

afterEach(() => vi.unstubAllEnvs());

describe("recorded ebook eligibility", () => {
  it("accepts an inspected gold publication for download and reading", () => {
    for (const status of ["stored", "verified"]) {
      expect(isEbookFileDownloadable({ ...file, status })).toBe(true);
      expect(isEbookFileNativeReadable({ ...file, status })).toBe(true);
    }
  });

  it.each(["missing", "quarantined", "replaced", "pending"])(
    "refuses %s files",
    (status) => {
      expect(isEbookFileDownloadable({ ...file, status })).toBe(false);
      expect(isEbookFileNativeReadable({ ...file, status })).toBe(false);
    },
  );

  it("refuses protected files even when the publication says clear", () => {
    expect(isEbookFileDownloadable({ ...file, drm: "adobe-adept" })).toBe(
      false,
    );
    expect(isEbookFileNativeReadable({ ...file, drm: "pdf-password" })).toBe(
      false,
    );
  });

  it.each([
    { integrity: "unverified" },
    { drm: "unverified" },
    { drm: "protected" },
    { downloadable: false },
  ])("refuses unaccepted validation %j", (change) => {
    const m = {
      ...metadata,
      medallion: {
        ...metadata.medallion,
        validation: { ...metadata.medallion.validation, ...change },
      },
    };
    expect(isEbookFileDownloadable({ ...file, metadata: m })).toBe(false);
    expect(isEbookFileNativeReadable({ ...file, metadata: m })).toBe(false);
  });

  it("requires the gold key and checksum to identify this publication", () => {
    for (const gold of [
      [],
      [{ ...object, sha256: "cd".repeat(32) }],
      [{ ...object, key: key.replace("gold/", "bronze/") }],
    ]) {
      expect(
        isEbookFileDownloadable({
          ...file,
          metadata: { medallion: { ...metadata.medallion, gold } },
        }),
      ).toBe(false);
    }
    expect(isEbookFileDownloadable({ ...file, sha256: "cd".repeat(32) })).toBe(
      false,
    );
    expect(isEbookFileDownloadable({ ...file, format: "pdf" })).toBe(false);
  });

  it("never treats a staged key without a recognized report as legacy", () => {
    for (const m of [
      undefined,
      {},
      { medallion: { ...metadata.medallion, version: 0 } },
    ]) {
      expect(isEbookFileDownloadable({ ...file, metadata: m })).toBe(false);
    }
    for (const s3Key of [
      key.replace("gold/", "bronze/"),
      key.replace("gold/", "silver/"),
      key + "/other",
      "other/file.epub",
    ]) {
      expect(isEbookFileDownloadable({ ...file, s3Key })).toBe(false);
    }
  });

  it("keeps download-only capability separate from native reading", () => {
    const m = {
      medallion: {
        ...metadata.medallion,
        validation: { ...metadata.medallion.validation, nativeReadable: false },
      },
    };
    expect(isEbookFileDownloadable({ ...file, metadata: m })).toBe(true);
    expect(isEbookFileNativeReadable({ ...file, metadata: m })).toBe(false);
    const text = {
      ...file,
      format: "txt",
      s3Key: ebookFileKey(sha, "txt"),
      metadata: undefined,
    };
    expect(isEbookFileDownloadable(text)).toBe(true);
    expect(isEbookFileNativeReadable(text)).toBe(false);
  });

  it("preserves accepted legacy keys with the configured prefix", () => {
    vi.stubEnv("EBOOKS_PREFIX", "legacy/");
    const legacy = {
      ...file,
      s3Key: ebookFileKey(sha, "epub"),
      metadata: undefined,
    };
    expect(isEbookFileNativeReadable(legacy)).toBe(true);
    expect(
      isEbookFileDownloadable({
        ...legacy,
        s3Key: legacy.s3Key.replace("legacy/", ""),
      }),
    ).toBe(false);
  });
});
