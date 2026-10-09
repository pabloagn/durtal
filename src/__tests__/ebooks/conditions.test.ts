import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEbookFileDownloadable,
  isEbookFileNativeReadable,
} from "@/lib/ebooks/conditions";
import { ebookFileKey, ebookGoldFileKey } from "@/lib/ebooks/keys";
import {
  malformedPublicationCases,
  publicationFixture,
} from "./publication-fixture";

const file = publicationFixture();
const sha = file.sha256;
const key = ebookGoldFileKey(sha, "epub");
const object = file.metadata.medallion.gold[0];
const metadata = file.metadata;

afterEach(() => vi.unstubAllEnvs());

describe("recorded ebook eligibility", () => {
  it.each(malformedPublicationCases())(
    "fails closed for malformed persisted JSON %#",
    (malformed) => {
      expect(() => isEbookFileDownloadable(malformed)).not.toThrow();
      expect(() => isEbookFileNativeReadable(malformed)).not.toThrow();
      expect(isEbookFileDownloadable(malformed)).toBe(false);
      expect(isEbookFileNativeReadable(malformed)).toBe(false);
    },
  );
  it("refuses malformed medallion evidence even on legacy keys", () => {
    for (const medallion of [null, {}, [], false, "invalid"]) {
      expect(
        isEbookFileDownloadable({
          ...file,
          s3Key: ebookFileKey(sha, "epub"),
          metadata: { medallion },
        }),
      ).toBe(false);
    }
    expect(
      isEbookFileDownloadable({
        ...file,
        s3Key: ebookFileKey(sha, "epub"),
        metadata: {},
      }),
    ).toBe(true);
  });
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

  it("requires actual boolean approval and safely ignores malformed publication members", () => {
    const malformed = {
      medallion: {
        ...metadata.medallion,
        gold: [null, false, "not-an-object"],
      },
    };
    expect(isEbookFileDownloadable({ ...file, metadata: malformed })).toBe(
      false,
    );
    const falseApproval = {
      medallion: {
        ...metadata.medallion,
        validation: { ...metadata.medallion.validation, downloadable: "true" },
      },
    };
    expect(isEbookFileDownloadable({ ...file, metadata: falseApproval })).toBe(
      false,
    );
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
