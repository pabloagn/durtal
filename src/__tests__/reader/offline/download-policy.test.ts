import { describe, expect, it } from "vitest";
import {
  canonicalDownloadUrl,
  downloadSpacePolicy,
  downloadVerification,
  matchDownloadedFile,
  validateDownloadIdentity,
} from "@/lib/reader/offline/download-policy";
import { cachedRangePolicy } from "@/lib/reader/offline/range-policy";
import { EBOOK, FILE, HASH, OTHER } from "./fixtures";
const trust = {
  appOrigin: "https://durtal.test",
  cdnBases: ["https://cdn.test/private/"],
};
const gold = `https://cdn.test/private/gold/ebooks/epub/aa/${HASH}/file.epub`;
const legacy = `https://cdn.test/private/files/aa/${HASH}.epub`;
const app = `https://durtal.test/api/ebooks/files/${FILE}`;
const identity = (canonicalUrl = gold) =>
  validateDownloadIdentity(
    {
      v: 1,
      ebookId: EBOOK,
      fileId: FILE,
      sha256: HASH,
      format: "epub",
      sizeBytes: 300_000_000,
      contentType: "application/epub+zip",
      canonicalUrl,
    },
    trust,
  );

describe("trusted unsigned byte identity", () => {
  it("strips credentials in query/hash while rejecting URL userinfo and untrusted bases", () => {
    expect(
      canonicalDownloadUrl(
        `${gold}?Expires=1&Signature=secret&Key-Pair-Id=key#fragment`,
        trust,
      ),
    ).toBe(gold);
    expect(() =>
      canonicalDownloadUrl(gold.replace("cdn.test", "attacker.test"), trust),
    ).toThrow("Untrusted");
    expect(() =>
      canonicalDownloadUrl(gold.replace("/private/", "/private-evil/"), trust),
    ).toThrow("Untrusted");
    expect(() =>
      canonicalDownloadUrl("https://user:secret@cdn.test/private/x", trust),
    ).toThrow("credentials");
  });
  it("matches expired CDN signatures and an app/CDN delivery switch by exact verified identity", () => {
    const book = identity();
    for (const url of [`${gold}?Expires=0&Signature=expired`, app, legacy])
      expect(matchDownloadedFile(url, [book], trust)?.sha256).toBe(HASH);
    expect(matchDownloadedFile(gold, [identity(app)], trust)?.fileId).toBe(
      FILE,
    );
    expect(matchDownloadedFile(app, [identity(legacy)], trust)?.fileId).toBe(
      FILE,
    );
  });
  it("never handles unrelated APIs, arbitrary hash URLs, bronze/silver, wrong shard/format or non-downloads", () => {
    const book = identity();
    for (const url of [
      app.replace(FILE, OTHER),
      app.replace("/api/ebooks/", "/API/EBOOKS/"),
      `${trust.appOrigin}/api/catalogue?sha=${HASH}`,
      gold.replace("/gold/", "/bronze/"),
      gold.replace("/gold/", "/silver/"),
      gold.replace("/aa/", "/bb/"),
      gold.replace("file.epub", "file.pdf"),
      gold.replace("cdn.test", "attacker.test"),
      `${trust.appOrigin}/random/${HASH}`,
    ])
      expect(matchDownloadedFile(url, [book], trust)).toBeNull();
    expect(matchDownloadedFile(gold, [], trust)).toBeNull();
  });
  it("refuses signed persisted identities, extraneous fields and unsupported formats", () => {
    const book = identity();
    expect(() =>
      validateDownloadIdentity(
        { ...book, canonicalUrl: `${gold}?Signature=secret` },
        trust,
      ),
    ).toThrow();
    expect(() =>
      validateDownloadIdentity({ ...book, token: "secret" }, trust),
    ).toThrow();
    expect(() =>
      validateDownloadIdentity({ ...book, format: "txt" }, trust),
    ).toThrow();
    expect(() =>
      validateDownloadIdentity({ ...book, contentType: "text/html" }, trust),
    ).toThrow("Content type");
    expect(() =>
      validateDownloadIdentity(
        { ...book, canonicalUrl: gold.replace(HASH, "b".repeat(64)) },
        trust,
      ),
    ).toThrow();
  });
  it("allows isolated secure localhost, refuses insecure LAN origins", () => {
    expect(
      canonicalDownloadUrl(`/api/ebooks/files/${FILE}`, {
        appOrigin: "http://127.0.0.1:3410",
        cdnBases: [],
      }),
    ).toBe(`http://127.0.0.1:3410/api/ebooks/files/${FILE}`);
    expect(() =>
      canonicalDownloadUrl(`/api/ebooks/files/${FILE}`, {
        appOrigin: "http://192.168.1.2:3410",
        cdnBases: [],
      }),
    ).toThrow("secure");
  });
  it("checks actual hash as well as size and cancellation", () => {
    const book = identity();
    expect(downloadVerification(book, book)).toBe("verified");
    expect(
      downloadVerification(book, { ...book, sha256: "b".repeat(64) }),
    ).toBe("integrity_mismatch");
    expect(
      downloadVerification(book, { ...book, sizeBytes: book.sizeBytes - 1 }),
    ).toBe("incomplete");
    expect(
      downloadVerification(book, { ...book, sizeBytes: book.sizeBytes + 1 }),
    ).toBe("incomplete");
    expect(downloadVerification(book, book, true)).toBe("cancelled");
  });
  it("reserves 10% plus 1 MiB, and treats missing estimates as unknown", () => {
    const requiredBytes = 330_000_000 + 1024 * 1024;
    expect(
      downloadSpacePolicy(300_000_000, {
        quota: requiredBytes + 100,
        usage: 100,
      }),
    ).toEqual({ kind: "enough", requiredBytes, availableBytes: requiredBytes });
    expect(
      downloadSpacePolicy(300_000_000, { quota: requiredBytes, usage: 1 }).kind,
    ).toBe("insufficient");
    expect(
      downloadSpacePolicy(300_000_000, { quota: 1, usage: 2 }),
    ).toMatchObject({ kind: "insufficient", availableBytes: 0 });
    expect(downloadSpacePolicy(300_000_000, null)).toEqual({ kind: "unknown" });
    expect(downloadSpacePolicy(300_000_000, { quota: NaN, usage: 0 })).toEqual({
      kind: "unknown",
    });
  });
});

describe("offline full-response Range slicing policy", () => {
  const plan = (range: string | null, extra = {}) =>
    cachedRangePolicy({
      method: "GET",
      range,
      sizeBytes: 100_000,
      sha256: HASH,
      contentType: "application/pdf",
      ...extra,
    });
  it.each([
    ["bytes=0-99", 0, 100],
    ["bytes=100-", 100, 100_000],
    ["bytes=-65557", 34_443, 100_000],
    ["bytes=0-0", 0, 1],
    ["bytes=99999-999999999999999999999999", 99_999, 100_000],
    ["bytes=-999999999999999999999999", 0, 100_000],
  ])("plans exact 206 bounds for %s", (range, start, end) => {
    const result = plan(range);
    expect(result).toMatchObject({
      status: 206,
      start,
      endExclusive: end,
      body: true,
    });
    expect(result.headers["Content-Range"]).toBe(
      `bytes ${start}-${end - 1}/100000`,
    );
    expect(result.headers["Content-Length"]).toBe(String(end - start));
    const bytes = new Uint8Array(100_000).map((_, index) => index % 251);
    expect(bytes.slice(result.start, result.endExclusive)).toEqual(
      bytes.slice(start, end),
    );
  });
  it.each([
    "bytes=100000-",
    "bytes=100000-100001",
    "bytes=999999999999999999999999-",
    "bytes=-0",
    "bytes=50-49",
  ])("plans 416 for unsatisfiable %s", (range) =>
    expect(plan(range)).toMatchObject({
      status: 416,
      body: false,
      headers: { "Content-Range": "bytes */100000", "Content-Length": "0" },
    }),
  );
  it.each([null, "bytes=0-1,3-4", "items=0-99", "bytes=-", "bytes=a-b"])(
    "returns full 200 for ignored %s",
    (range) =>
      expect(plan(range)).toMatchObject({
        status: 200,
        start: 0,
        endExclusive: 100_000,
      }),
  );
  it("HEAD has full headers and no body, and If-Range only accepts the exact strong ETag", () => {
    expect(plan("bytes=0-99", { method: "HEAD" })).toMatchObject({
      status: 200,
      body: false,
      headers: { "Content-Length": "100000" },
    });
    expect(plan("bytes=0-99", { ifRange: `"${HASH}"` }).status).toBe(206);
    expect(plan("bytes=0-99", { ifRange: `W/"${HASH}"` }).status).toBe(200);
    expect(
      plan("bytes=0-99", { ifRange: "Fri, 09 Oct 2026 00:00:00 GMT" }).status,
    ).toBe(200);
  });
  it("provides integer lengths, SHA ETag and no Content-Encoding for every response", () => {
    for (const range of [null, "bytes=0-99", "bytes=100000-"]) {
      const result = plan(range);
      expect(result.headers["Accept-Ranges"]).toBe("bytes");
      expect(result.headers.ETag).toBe(`"${HASH}"`);
      expect(result.headers["Content-Length"]).toMatch(/^\d+$/);
      expect(result.headers).not.toHaveProperty("Content-Encoding");
    }
    expect(plan("bytes=0-0", { sizeBytes: 0 }).status).toBe(416);
    expect(() =>
      plan(null, { contentType: "application/pdf\r\nInjected: header" }),
    ).toThrow();
  });
});
