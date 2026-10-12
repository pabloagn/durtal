import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCatalogueCover, type CatalogueFile } from "@/lib/ebooks/delivery/files";
import { isReadableFormat, type EbookFormat } from "@/lib/ebooks/formats";
import { publicationFixture } from "./publication-fixture";
import { ebookGoldDerivedKey, ebookGoldFileKey, ebookSilverKey, type EbookCoverWidth } from "@/lib/ebooks/keys";
import {
  signatureExpiry,
  signedDerivedUrlBase,
  signedGoldCoverBase,
  signedFileUrl,
  UndeliverableFileError,
} from "@/lib/ebooks/delivery/sign";
import { coverUrlFor, fileUrlFor } from "@/lib/ebooks/delivery/url";

/*
 * SLN-491: CloudFront signed URLs. The format was checked byte for byte
 * against AWS's @aws-sdk/cloudfront-signer when it was written; here every
 * signature is verified with the public key of a key made for the test.
 */

const catalogue = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { query: { ebooks: { findFirst: catalogue.findFirst } } },
}));

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const sha = "ab".repeat(32);
const HOUR = 3600_000;
const file = (over: Partial<CatalogueFile> = {}) =>
  ({
    id: "0b7c6f0e-6a55-4a3e-9d33-1f1e7c2b9a10",
    ebookId: "e",
    sha256: sha,
    s3Key: `files/ab/${sha}.epub`,
    format: "epub",
    sizeBytes: 10,
    contentType: "application/epub+zip",
    status: "stored",
    drm: null,
    ...over,
  }) as CatalogueFile;

/** Issue the capability through the real fresh reader and publication validator. */
async function catalogueCover(format: EbookFormat, widths: readonly EbookCoverWidth[]) {
  const publication = publicationFixture(format, sha);
  publication.metadata.medallion.validation.nativeReadable = isReadableFormat(format);
  const [original, recordedCover, manifest] = publication.metadata.medallion.gold;
  publication.metadata.medallion.gold = [
    original,
    ...widths.map((width) => ({
      ...recordedCover,
      key: ebookGoldDerivedKey(sha, format, "cd".repeat(32), `cover-${width}.webp`),
    })),
    manifest,
  ];
  const storedFile = { ...publication, id: "file", coverKey: null };
  catalogue.findFirst.mockResolvedValue({
    id: "book", preferredFileId: storedFile.id, coverKey: null, files: [storedFile],
  });
  const cover = await readCatalogueCover("book");
  expect(cover?.sha256).toBe(sha);
  expect(cover?.widths).toEqual(widths);
  if (!cover?.sha256) throw new Error("Expected validated catalogue cover evidence");
  return cover;
}

/** CloudFront's base64 back to bytes */
const unCloudFront = (text: string) =>
  Buffer.from(
    text.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"),
    "base64",
  );
const verifies = (text: string, signature: string) =>
  createVerify("RSA-SHA1")
    .update(text)
    .verify(publicKey, unCloudFront(signature));

beforeEach(() => {
  catalogue.findFirst.mockReset();
  vi.stubEnv("EBOOK_DELIVERY", "cloudfront");
  vi.stubEnv("EBOOK_CDN_URL", "https://d111111abcdef8.cloudfront.net");
  vi.stubEnv("EBOOK_CDN_KEY_PAIR_ID", "K2JCJMDEHXQW5F");
  vi.stubEnv("EBOOK_CDN_PRIVATE_KEY", Buffer.from(pem).toString("base64"));
});
afterEach(() => { vi.unstubAllEnvs(); catalogue.findFirst.mockReset(); });

describe("signedFileUrl", () => {
  const now = Date.UTC(2026, 9, 7, 13, 20);

  it("is a canned-policy URL: Expires, Key-Pair-Id and a Signature of the exact policy", () => {
    const { url, expiresAt } = signedFileUrl(file(), now);
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      `https://d111111abcdef8.cloudfront.net/files/ab/${sha}.epub`,
    );
    expect([...parsed.searchParams.keys()]).toEqual([
      "Expires",
      "Key-Pair-Id",
      "Signature",
    ]);
    const expires = Number(parsed.searchParams.get("Expires"));
    expect(expires * 1000).toBe(expiresAt.getTime());
    expect(parsed.searchParams.get("Key-Pair-Id")).toBe("K2JCJMDEHXQW5F");
    const policy = `{"Statement":[{"Resource":"https://d111111abcdef8.cloudfront.net/files/ab/${sha}.epub","Condition":{"DateLessThan":{"AWS:EpochTime":${expires}}}}]}`;
    expect(verifies(policy, parsed.searchParams.get("Signature")!)).toBe(true);
    // The query is CloudFront's URL-safe alphabet, sent as it is
    expect(parsed.search).not.toMatch(/[%+/]/);
  });

  it("gives the identical URL within one 6-hour window, and a new one after its boundary", () => {
    const start = Date.UTC(2026, 9, 7, 12, 0, 1);
    const a = signedFileUrl(file(), start).url;
    expect(signedFileUrl(file(), start + 5 * HOUR).url).toBe(a);
    expect(signedFileUrl(file(), Date.UTC(2026, 9, 7, 18, 0, 1)).url).not.toBe(
      a,
    );
  });

  it("is always good for at least 6 hours, and never more than 12", () => {
    for (
      let t = Date.UTC(2026, 9, 7);
      t < Date.UTC(2026, 9, 8);
      t += 17 * 60_000 + 3_000
    ) {
      const left = signatureExpiry(t) * 1000 - t;
      expect(left).toBeGreaterThanOrEqual(6 * HOUR);
      expect(left).toBeLessThanOrEqual(12 * HOUR);
    }
  });

  it("throws for a quarantined, missing, replaced or DRM file", () => {
    for (const status of ["quarantined", "missing", "replaced"] as const)
      expect(() => signedFileUrl(file({ status }), now)).toThrow(
        UndeliverableFileError,
      );
    expect(() => signedFileUrl(file({ drm: "kindle" }), now)).toThrow(
      /DRM: kindle/,
    );
    expect(() =>
      signedFileUrl(file({ status: "verified" }), now),
    ).not.toThrow();
  });

  it("refuses to sign when delivery is the app's", () => {
    vi.stubEnv("EBOOK_DELIVERY", "app");
    expect(() => signedFileUrl(file(), now)).toThrow(/not configured/);
    expect(fileUrlFor(file())).toEqual({
      url: "/api/ebooks/files/0b7c6f0e-6a55-4a3e-9d33-1f1e7c2b9a10",
      expiresAt: null,
    });
  });
});

describe("signedDerivedUrlBase", () => {
  it("uses the cover-only policy at the reader/settings URL caller for canonical gold formats", async () => {
    const legacy = signedDerivedUrlBase();
    for (const format of ["epub", "pdf", "txt", "cbz"] as const) {
      const key = ebookGoldDerivedKey(sha, format, "cd".repeat(32), "cover-800.webp");
      const cover = await catalogueCover(format, [240, 800]);
      expect(cover.key).toBe(key);
      for (const width of [240, 800] as const) {
        // A caller-provided legacy base must never broaden the gold policy.
        const delivery = coverUrlFor(cover, width, legacy)!;
        const url = new URL(delivery.url);
        expect(url.pathname).toBe(`/${ebookGoldDerivedKey(sha, format, "cd".repeat(32), `cover-${width}.webp`)}`);
        const policy = unCloudFront(url.searchParams.get("Policy")!).toString("utf8");
        expect(JSON.parse(policy).Statement).toEqual([{
          Resource: "https://d111111abcdef8.cloudfront.net/gold/ebooks/*/*/*/derived/v2/*/cover-*.webp",
          Condition: { DateLessThan: { "AWS:EpochTime": delivery.expiresAt!.getTime() / 1000 } },
        }]);
        expect(verifies(policy, url.searchParams.get("Signature")!)).toBe(true);
      }
      expect(coverUrlFor(cover, 400)).toBeNull();
    }
  });
  it("rejects unavailable widths, mismatched identities and non-cover catalogue keys in both delivery modes", async () => {
    const key = ebookGoldDerivedKey(sha, "epub", "cd".repeat(32), "cover-240.webp");
    for (const mode of ["app", "cloudfront"]) {
      vi.stubEnv("EBOOK_DELIVERY", mode);
      const cover = await catalogueCover("epub", [240]);
      expect(cover.key).toBe(key);
      expect(coverUrlFor(cover, 400)).toBeNull();
      expect(coverUrlFor({ ...cover, widths: undefined }, 240)).toBeNull();
      expect(coverUrlFor({ ...cover, sha256: "ef".repeat(32) }, 240)).toBeNull();
      expect(coverUrlFor(cover, 241 as 240)).toBeNull();
      for (const invalid of [ebookGoldFileKey(sha, "epub"),
        ebookGoldDerivedKey(sha, "epub", "cd".repeat(32), "manifest.json"),
        ebookSilverKey(sha, "epub", "cd".repeat(32)), key.replace("gold/", "bronze/"),
        key.replace("/epub/", "/unknown/"), key.replace("/ab/", "/ef/")])
        expect(coverUrlFor({ ...cover, key: invalid }, 240), invalid).toBeNull();
      expect(coverUrlFor({ ...cover, key: `derived/${"ef".repeat(32)}/cover-240.webp` }, 240)).toBeNull();
    }
  });
  it("signs one verified policy scoped to gold cover images and excludes all other stages and objects", () => {
    const base = signedGoldCoverBase(Date.UTC(2026, 9, 9, 12));
    const query = new URLSearchParams(base.query);
    const raw = unCloudFront(query.get("Policy")!).toString("utf8");
    expect(verifies(raw, query.get("Signature")!)).toBe(true);
    const statements = JSON.parse(raw).Statement as { Resource: string }[];
    expect(statements).toHaveLength(1);
    const permits = (key: string) =>
      statements.some(({ Resource }) => {
        const escaped = Resource.split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*");
        return new RegExp(`^${escaped}$`).test(
          `https://d111111abcdef8.cloudfront.net/${key}`,
        );
      });
    const folder = `ebooks/epub/ab/${sha}`;
    for (const width of [240, 400, 800])
      expect(
        permits(
          `gold/${folder}/derived/v2/${"cd".repeat(32)}/cover-${width}.webp`,
        ),
      ).toBe(true);
    for (const key of [
      `gold/${folder}/file.epub`,
      `gold/${folder}/derived/v2/${"cd".repeat(32)}/manifest.json`,
      `bronze/${folder}/source.epub`,
      `silver/${folder}/v2/${"cd".repeat(32)}.json`,
      `derived/${sha}/cover-240.webp`,
      `gold/${folder}/derived/v2/${"cd".repeat(32)}/thumbnail.webp`,
      "gold/other-domain/cover-240.webp",
    ])
      expect(permits(key)).toBe(false);
  });
  it("signs one custom policy for derived/* and nothing else", () => {
    vi.stubEnv("EBOOKS_PREFIX", "ebooks/");
    const now = Date.UTC(2026, 9, 7, 20, 0);
    const { base, query, expiresAt } = signedDerivedUrlBase(now);
    expect(base).toBe("https://d111111abcdef8.cloudfront.net/ebooks/derived/");
    const params = new URLSearchParams(query);
    expect([...params.keys()]).toEqual(["Policy", "Key-Pair-Id", "Signature"]);
    const policy = unCloudFront(params.get("Policy")!).toString("utf8");
    expect(JSON.parse(policy)).toEqual({
      Statement: [
        {
          Resource: "https://d111111abcdef8.cloudfront.net/ebooks/derived/*",
          Condition: {
            DateLessThan: { "AWS:EpochTime": expiresAt.getTime() / 1000 },
          },
        },
      ],
    });
    expect(verifies(policy, params.get("Signature")!)).toBe(true);
  });

  it("gives every cover of a page the same signature", () => {
    const derived = signedDerivedUrlBase();
    const cover = (n: string) =>
      ({ ebookId: n, sha256: n.repeat(64) }) as Parameters<
        typeof coverUrlFor
      >[0];
    const a = coverUrlFor(cover("a"), 400, derived)!;
    const b = coverUrlFor(cover("b"), 240, derived)!;
    expect(a.url).toBe(
      `https://d111111abcdef8.cloudfront.net/derived/${"a".repeat(64)}/cover-400.webp?${derived.query}`,
    );
    expect(b.url.endsWith(`?${derived.query}`)).toBe(true);
    expect(coverUrlFor(cover("c"), 800)!.url.split("?")[1]).toBe(derived.query);
    vi.stubEnv("EBOOK_DELIVERY", "app");
    expect(coverUrlFor(cover("a"), 240)).toEqual({
      url: "/api/reader/a/cover?w=240",
      expiresAt: null,
    });
    expect(
      coverUrlFor(
        { ebookId: "a", sha256: null } as Parameters<typeof coverUrlFor>[0],
        240,
      ),
    ).toBeNull();
  });
});
