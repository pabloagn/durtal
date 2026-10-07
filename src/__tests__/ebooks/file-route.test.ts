import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

/* SLN-491: the app's own file route, with S3 answering byte ranges from memory */

const mocks = vi.hoisted(() => ({ file: null as Record<string, unknown> | null }));
vi.mock("@/lib/ebooks/delivery/files", async (original) => ({
  ...(await original<typeof import("@/lib/ebooks/delivery/files")>()),
  readCatalogueFile: vi.fn(async () => mocks.file),
}));

import { GET, HEAD } from "@/app/api/ebooks/files/[fileId]/route";
import { readCatalogueFile } from "@/lib/ebooks/delivery/files";

const id = "0b7c6f0e-6a55-4a3e-9d33-1f1e7c2b9a10";
const sha = "cd".repeat(32);
const size = 70_000;
const bytes = Uint8Array.from({ length: size }, (_, i) => i % 251);
let stored: Map<string, Uint8Array>;
let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stored = new Map([[`files/cd/${sha}.epub`, bytes]]);
  mocks.file = { id, ebookId: "e", sha256: sha, s3Key: `files/cd/${sha}.epub`, format: "epub", sizeBytes: size, contentType: "application/epub+zip", status: "stored", drm: null };
  send = vi.spyOn(S3Client.prototype, "send").mockImplementation((async (command: unknown) => {
    const missing = () => Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    if (command instanceof GetObjectCommand) {
      const object = stored.get(command.input.Key!);
      if (!object) throw missing();
      const [, a, b] = /^bytes=(\d+)-(\d*)$/.exec(command.input.Range!)!;
      const slice = object.slice(Number(a), b === "" ? undefined : Number(b) + 1);
      return { ContentLength: slice.length, Body: { transformToWebStream: () => new Blob([slice]).stream() } };
    }
    if (command instanceof HeadObjectCommand) {
      const object = stored.get(command.input.Key!);
      if (!object) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: object.length };
    }
    throw new Error("Unexpected S3 command");
  }) as never);
});
afterEach(() => {
  send.mockRestore();
  vi.mocked(readCatalogueFile).mockClear();
});

const call = (method: "GET" | "HEAD", headers: Record<string, string> = {}, fileId = id) => {
  const req = new NextRequest(`http://localhost/api/ebooks/files/${fileId}`, { method, headers });
  return (method === "GET" ? GET : HEAD)(req, { params: Promise.resolve({ fileId }) });
};
const body = async (res: Response) => new Uint8Array(await res.arrayBuffer());

describe("GET /api/ebooks/files/[fileId]", () => {
  it("sends the whole file with 200 and Accept-Ranges when no range is asked", async () => {
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe(String(size));
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${sha}"`);
    expect(await body(res)).toEqual(bytes);
  });

  it("answers bytes=0-99 with 206, its Content-Range and exactly 100 bytes", async () => {
    const res = await call("GET", { range: "bytes=0-99" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-99/${size}`);
    expect(res.headers.get("content-length")).toBe("100");
    expect(await body(res)).toEqual(bytes.slice(0, 100));
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect((send.mock.calls[0][0] as GetObjectCommand).input.Range).toBe("bytes=0-99");
  });

  it("answers the suffix bytes=-65557 with the file's tail (a zip's central directory)", async () => {
    const res = await call("GET", { range: "bytes=-65557" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes ${size - 65557}-${size - 1}/${size}`);
    expect(await body(res)).toEqual(bytes.slice(size - 65557));
  });

  it("answers an open range to the end, and only the first of several ranges", async () => {
    const open = await call("GET", { range: `bytes=${size - 10}-` });
    expect(open.headers.get("content-range")).toBe(`bytes ${size - 10}-${size - 1}/${size}`);
    expect(await body(open)).toEqual(bytes.slice(size - 10));
    const several = await call("GET", { range: "bytes=10-19, 30-39" });
    expect(several.status).toBe(206);
    expect(several.headers.get("content-range")).toBe(`bytes 10-19/${size}`);
  });

  it("answers bytes=<size>- with 416 and the size", async () => {
    const res = await call("GET", { range: `bytes=${size}-` });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${size}`);
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a header that is not a byte range", async () => {
    const res = await call("GET", { range: "pages=1-2" });
    expect(res.status).toBe(200);
  });

  it("answers 304 to If-None-Match with the file's ETag, without reading S3", async () => {
    const res = await call("GET", { "if-none-match": `"${sha}"` });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(`"${sha}"`);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a malformed id with 400 before any database or S3 call", async () => {
    for (const bad of ["abc", "../x", `${id}x`]) expect((await call("GET", {}, bad)).status).toBe(400);
    expect(readCatalogueFile).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown file, a missing object, and quarantined, replaced, missing or DRM files", async () => {
    stored.clear();
    expect((await call("GET")).status).toBe(404);
    stored.set(`files/cd/${sha}.epub`, bytes);
    for (const over of [{ status: "quarantined" }, { status: "replaced" }, { status: "missing" }, { drm: "adobe-adept" }]) {
      mocks.file = { ...mocks.file!, status: "stored", drm: null, ...over };
      expect((await call("GET")).status).toBe(404);
    }
    mocks.file = null;
    expect((await call("GET")).status).toBe(404);
  });

  it("serves a verified file, with the type of its format whatever the row says", async () => {
    mocks.file = { ...mocks.file!, status: "verified", contentType: "text/html" };
    const res = await call("GET", { range: "bytes=0-0" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
  });
});

describe("HEAD /api/ebooks/files/[fileId]", () => {
  it("returns the headers and no body", async () => {
    const res = await call("HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(size));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("etag")).toBe(`"${sha}"`);
    expect(res.body).toBeNull();
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("answers 404 for a missing object and 400 for a malformed id", async () => {
    stored.clear();
    expect((await call("HEAD")).status).toBe(404);
    expect((await call("HEAD", {}, "nope")).status).toBe(400);
  });
});
