import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/media/ingest", () => ({
  ingestMedia: mocks.ingest,
  MediaIngestError: class extends Error {},
}));
vi.mock("@/lib/actions/collections", () => ({
  updateCollection: mocks.update,
}));
import { POST } from "@/app/api/media/upload/route";
afterEach(() => vi.restoreAllMocks());
describe("malformed multipart upload", () => {
  it("returns a safe retry code before touching S3 or the database", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = new NextRequest("http://localhost/api/media/upload", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=test" },
      body: "truncated body",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID_MULTIPART",
      requestId: expect.any(String),
    });
    for (const call of Object.values(mocks))
      expect(call).not.toHaveBeenCalled();
  });
});
