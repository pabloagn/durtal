import { afterEach, describe, expect, it, vi } from "vitest";
import {
  coverKeySha256,
  ebookDerivedKey,
  ebookExtension,
  ebookFileKey,
  ebookStagingKey,
  type EbookDerivedName,
} from "@/lib/ebooks/keys";

/* SLN-491: the e-book bucket's keys, built only from checked parts */

const sha = "0f".repeat(32);
const upload = "4f6d2c1a-9b3e-4c5d-8e7f-0a1b2c3d4e5f";

afterEach(() => vi.unstubAllEnvs());

describe("e-book keys", () => {
  it("files/<sha256[0:2]>/<sha256>.<ext>", () => {
    expect(ebookFileKey(sha, "epub")).toBe(`files/0f/${sha}.epub`);
    expect(ebookFileKey(sha, ebookExtension("other"))).toBe(`files/0f/${sha}.bin`);
  });

  it("derived/<sha256>/<name> for the three covers and the manifest", () => {
    for (const name of ["cover-240.webp", "cover-400.webp", "cover-800.webp", "manifest.json"] as const)
      expect(ebookDerivedKey(sha, name)).toBe(`derived/${sha}/${name}`);
  });

  it("staging/<uploadId>/<name>", () => {
    expect(ebookStagingKey(upload, "original.epub")).toBe(`staging/${upload}/original.epub`);
  });

  it("puts EBOOKS_PREFIX before all three", () => {
    vi.stubEnv("EBOOKS_PREFIX", "ebooks/");
    expect(ebookFileKey(sha, "pdf")).toBe(`ebooks/files/0f/${sha}.pdf`);
    expect(ebookDerivedKey(sha, "manifest.json")).toBe(`ebooks/derived/${sha}/manifest.json`);
    expect(ebookStagingKey(upload, "part-1")).toBe(`ebooks/staging/${upload}/part-1`);
  });

  it("refuses a checksum that is not 64 lowercase hex", () => {
    for (const bad of ["", "0f", sha.toUpperCase(), `${sha}0`, `../${sha.slice(3)}`, sha.replace(/^0/, "g")]) {
      expect(() => ebookFileKey(bad, "epub")).toThrow(/64 lowercase hex/);
      expect(() => ebookDerivedKey(bad, "manifest.json")).toThrow(/64 lowercase hex/);
    }
  });

  it("refuses an unknown extension or derived name", () => {
    for (const bad of ["html", "svg", "epub/../x", "", "EPUB", "other"]) expect(() => ebookFileKey(sha, bad)).toThrow(/Unknown e-book extension/);
    expect(() => ebookDerivedKey(sha, "cover-1000.webp" as EbookDerivedName)).toThrow(/Unknown derived object/);
  });

  it("refuses an upload id that is not a uuid, and a name with a folder in it", () => {
    for (const bad of ["", "abc", `${upload}/..`, "../4f6d2c1a-9b3e-4c5d-8e7f-0a1b2c3d4e5f"]) expect(() => ebookStagingKey(bad, "a.epub")).toThrow(/uuid/);
    for (const bad of ["", "a/b.epub", "../a.epub", "..", ".hidden", "a..epub", "x".repeat(129)]) expect(() => ebookStagingKey(upload, bad)).toThrow(/plain file name/);
  });

  it("reads the checksum out of a cover key it built, and of nothing else", () => {
    expect(coverKeySha256(ebookDerivedKey(sha, "cover-400.webp"))).toBe(sha);
    expect(coverKeySha256(`derived/${sha}/manifest.json`)).toBeNull();
    expect(coverKeySha256(`gold/covers/${sha}/cover-400.webp`)).toBeNull();
    expect(coverKeySha256(`derived/${sha}/cover-400.webp/../x`)).toBeNull();
    expect(coverKeySha256(null)).toBeNull();
    vi.stubEnv("EBOOKS_PREFIX", "ebooks/");
    expect(coverKeySha256(`ebooks/derived/${sha}/cover-800.webp`)).toBe(sha);
    expect(coverKeySha256(`derived/${sha}/cover-800.webp`)).toBeNull();
  });
});
