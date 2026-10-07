import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogueFile } from "@/lib/ebooks/delivery/files";
import { signatureExpiry, signedDerivedUrlBase, signedFileUrl, UndeliverableFileError } from "@/lib/ebooks/delivery/sign";
import { coverUrlFor, fileUrlFor } from "@/lib/ebooks/delivery/url";

/*
 * SLN-491: CloudFront signed URLs. The format was checked byte for byte
 * against AWS's @aws-sdk/cloudfront-signer when it was written; here every
 * signature is verified with the public key of a key made for the test.
 */

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const sha = "ab".repeat(32);
const HOUR = 3600_000;
const file = (over: Partial<CatalogueFile> = {}) =>
  ({ id: "0b7c6f0e-6a55-4a3e-9d33-1f1e7c2b9a10", ebookId: "e", sha256: sha, s3Key: `files/ab/${sha}.epub`, format: "epub", sizeBytes: 10, contentType: "application/epub+zip", status: "stored", drm: null, ...over }) as CatalogueFile;

/** CloudFront's base64 back to bytes */
const unCloudFront = (text: string) => Buffer.from(text.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"), "base64");
const verifies = (text: string, signature: string) => createVerify("RSA-SHA1").update(text).verify(publicKey, unCloudFront(signature));

beforeEach(() => {
  vi.stubEnv("EBOOK_DELIVERY", "cloudfront");
  vi.stubEnv("EBOOK_CDN_URL", "https://d111111abcdef8.cloudfront.net");
  vi.stubEnv("EBOOK_CDN_KEY_PAIR_ID", "K2JCJMDEHXQW5F");
  vi.stubEnv("EBOOK_CDN_PRIVATE_KEY", Buffer.from(pem).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());

describe("signedFileUrl", () => {
  const now = Date.UTC(2026, 9, 7, 13, 20);

  it("is a canned-policy URL: Expires, Key-Pair-Id and a Signature of the exact policy", () => {
    const { url, expiresAt } = signedFileUrl(file(), now);
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(`https://d111111abcdef8.cloudfront.net/files/ab/${sha}.epub`);
    expect([...parsed.searchParams.keys()]).toEqual(["Expires", "Key-Pair-Id", "Signature"]);
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
    expect(signedFileUrl(file(), Date.UTC(2026, 9, 7, 18, 0, 1)).url).not.toBe(a);
  });

  it("is always good for at least 6 hours, and never more than 12", () => {
    for (let t = Date.UTC(2026, 9, 7); t < Date.UTC(2026, 9, 8); t += 17 * 60_000 + 3_000) {
      const left = signatureExpiry(t) * 1000 - t;
      expect(left).toBeGreaterThanOrEqual(6 * HOUR);
      expect(left).toBeLessThanOrEqual(12 * HOUR);
    }
  });

  it("throws for a quarantined, missing, replaced or DRM file", () => {
    for (const status of ["quarantined", "missing", "replaced"] as const) expect(() => signedFileUrl(file({ status }), now)).toThrow(UndeliverableFileError);
    expect(() => signedFileUrl(file({ drm: "kindle" }), now)).toThrow(/DRM: kindle/);
    expect(() => signedFileUrl(file({ status: "verified" }), now)).not.toThrow();
  });

  it("refuses to sign when delivery is the app's", () => {
    vi.stubEnv("EBOOK_DELIVERY", "app");
    expect(() => signedFileUrl(file(), now)).toThrow(/not configured/);
    expect(fileUrlFor(file())).toEqual({ url: "/api/ebooks/files/0b7c6f0e-6a55-4a3e-9d33-1f1e7c2b9a10", expiresAt: null });
  });
});

describe("signedDerivedUrlBase", () => {
  it("signs one custom policy for derived/* and nothing else", () => {
    vi.stubEnv("EBOOKS_PREFIX", "ebooks/");
    const now = Date.UTC(2026, 9, 7, 20, 0);
    const { base, query, expiresAt } = signedDerivedUrlBase(now);
    expect(base).toBe("https://d111111abcdef8.cloudfront.net/ebooks/derived/");
    const params = new URLSearchParams(query);
    expect([...params.keys()]).toEqual(["Policy", "Key-Pair-Id", "Signature"]);
    const policy = unCloudFront(params.get("Policy")!).toString("utf8");
    expect(JSON.parse(policy)).toEqual({
      Statement: [{ Resource: "https://d111111abcdef8.cloudfront.net/ebooks/derived/*", Condition: { DateLessThan: { "AWS:EpochTime": expiresAt.getTime() / 1000 } } }],
    });
    expect(verifies(policy, params.get("Signature")!)).toBe(true);
  });

  it("gives every cover of a page the same signature", () => {
    const derived = signedDerivedUrlBase();
    const cover = (n: string) => ({ ebookId: n, sha256: n.repeat(64) }) as Parameters<typeof coverUrlFor>[0];
    const a = coverUrlFor(cover("a"), 400, derived)!;
    const b = coverUrlFor(cover("b"), 240, derived)!;
    expect(a.url).toBe(`https://d111111abcdef8.cloudfront.net/derived/${"a".repeat(64)}/cover-400.webp?${derived.query}`);
    expect(b.url.endsWith(`?${derived.query}`)).toBe(true);
    expect(coverUrlFor(cover("c"), 800)!.url.split("?")[1]).toBe(derived.query);
    vi.stubEnv("EBOOK_DELIVERY", "app");
    expect(coverUrlFor(cover("a"), 240)).toEqual({ url: "/api/reader/a/cover?w=240", expiresAt: null });
    expect(coverUrlFor({ ebookId: "a", sha256: null } as Parameters<typeof coverUrlFor>[0], 240)).toBeNull();
  });
});
