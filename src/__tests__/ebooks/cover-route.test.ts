import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/* SLN-491: an e-book's cover, redirected to CloudFront or streamed by the app */

const mocks = vi.hoisted(() => ({ cover: null as Record<string, unknown> | null }));
vi.mock("@/lib/ebooks/delivery/files", async (original) => ({
  ...(await original<typeof import("@/lib/ebooks/delivery/files")>()),
  readCatalogueCover: vi.fn(async () => mocks.cover),
}));

import { GET } from "@/app/api/reader/[ebookId]/cover/route";

const id = "6f1c0d3e-2b4a-4c5d-9e8f-7a6b5c4d3e2f";
const sha = "9e".repeat(32);
const webp = new TextEncoder().encode("RIFF....WEBPVP8 cover");
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "durtal-ebook-cover-"));
  mkdirSync(join(dir, `durtal/derived/${sha}`), { recursive: true });
  writeFileSync(join(dir, `durtal/derived/${sha}/cover-400.webp`), webp);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const cover = (query: string, ebookId = id) =>
  GET(new NextRequest(`http://localhost/api/reader/${ebookId}/cover${query}`), {
    params: Promise.resolve({ ebookId }),
  });

describe("GET /api/reader/[ebookId]/cover", () => {
  it("streams the derived WebP when the app delivers", async () => {
    vi.stubEnv("DURTAL_PREVIEW_S3_DIR", dir);
    mocks.cover = { ebookId: id, sha256: sha };
    const res = await cover("?w=400");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("content-length")).toBe(String(webp.length));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(webp);
    // A width that was never written is a missing cover
    expect((await cover("?w=800")).status).toBe(404);
  });

  it("redirects to the signed cover with CloudFront, cached no longer than the signature", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv("EBOOK_DELIVERY", "cloudfront");
    vi.stubEnv("EBOOK_CDN_URL", "https://d111111abcdef8.cloudfront.net");
    vi.stubEnv("EBOOK_CDN_KEY_PAIR_ID", "K2JCJMDEHXQW5F");
    vi.stubEnv("EBOOK_CDN_PRIVATE_KEY", Buffer.from(privateKey.export({ type: "pkcs1", format: "pem" }).toString()).toString("base64"));
    mocks.cover = { ebookId: id, sha256: sha };
    const res = await cover("?w=240");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe(`/derived/${sha}/cover-240.webp`);
    expect([...location.searchParams.keys()]).toEqual(["Policy", "Key-Pair-Id", "Signature"]);
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control")!)![1]);
    expect(maxAge).toBeGreaterThanOrEqual(5 * 3600);
    expect(maxAge).toBeLessThanOrEqual(86400);
  });

  it("answers 400 without a valid w, and for a malformed id", async () => {
    mocks.cover = { ebookId: id, sha256: sha };
    for (const query of ["", "?w=", "?w=300", "?w=400.0", "?w=abc"]) expect((await cover(query)).status).toBe(400);
    expect((await cover("?w=400", "nope")).status).toBe(400);
  });

  it("answers 404 for an e-book with no cover, and for no e-book", async () => {
    mocks.cover = { ebookId: id, sha256: null };
    expect((await cover("?w=400")).status).toBe(404);
    mocks.cover = null;
    expect((await cover("?w=400")).status).toBe(404);
  });
});
