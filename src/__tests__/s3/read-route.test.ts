import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/s3/client", () => ({ s3: { send: mocks.send }, S3_BUCKET: "test" }));

import { GET } from "@/app/api/s3/read/route";
import { contentHeaders } from "@/lib/s3/read-headers";

afterEach(() => mocks.send.mockReset());

function stored(contentType: string | undefined, body = "<script>alert(1)</script>") {
  const bytes = new TextEncoder().encode(body);
  mocks.send.mockResolvedValue({
    ContentType: contentType,
    ContentLength: bytes.length,
    ETag: '"abc"',
    Body: {
      transformToWebStream: () => new Blob([bytes]).stream(),
      transformToByteArray: async () => bytes,
    },
  });
}

const read = (query: string, headers?: Record<string, string>) =>
  GET(new NextRequest(`http://localhost/api/s3/read?${query}`, { headers }));

describe("GET /api/s3/read headers", () => {
  it("shows a raster image inline, with nosniff and a sandbox", async () => {
    stored("image/webp");
    const res = await read("key=gold/covers/a/thumb.webp&v=1");
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("downloads stored HTML as an attachment, never inline", async () => {
    stored("text/html");
    const res = await read("key=gold/comments/work/a/c/evil.html");
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("downloads stored SVG as an attachment", async () => {
    stored("image/svg+xml", "<svg onload=alert(1)></svg>");
    const res = await read("key=gold/comments/work/a/c/evil.svg");
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("treats a missing type as a download", async () => {
    stored(undefined);
    const res = await read("key=gold/comments/work/a/c/unknown");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe("attachment");
  });

  it("keeps the safety headers on a 304", async () => {
    mocks.send.mockRejectedValue({ $metadata: { httpStatusCode: 304 } });
    const res = await read("key=gold/covers/a/thumb.webp", { "if-none-match": '"abc"' });
    expect(res.status).toBe(304);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });
});

describe("contentHeaders", () => {
  it("ignores parameters and case in the type", () => {
    expect(contentHeaders("Image/JPEG; charset=binary")["Content-Disposition"]).toBe("inline");
  });
});
