import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadMediaFile, mediaResponseError } from "@/lib/utils/media-upload";
afterEach(() => vi.unstubAllGlobals());
const rejected = () =>
  Response.json(
    { code: "INVALID_MULTIPART", error: "Image did not arrive intact" },
    { status: 400 },
  );
describe("upload retry boundary", () => {
  it("rebuilds the multipart body and retries once for a confirmed pre-write rejection", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", request);
    const makeBody = vi.fn(() => new FormData());
    await uploadMediaFile(makeBody);
    expect(request).toHaveBeenCalledTimes(2);
    expect(makeBody).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].body).not.toBe(
      request.mock.calls[1][1].body,
    );
  });
  it("stops after the second malformed request and preserves the error", async () => {
    const request = vi.fn().mockImplementation(async () => rejected());
    vi.stubGlobal("fetch", request);
    await expect(uploadMediaFile(() => new FormData())).rejects.toThrow(
      "Image did not arrive intact",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([400, 413, 500, 503])(
    "never retries an unclassified HTTP %s failure",
    async (status) => {
      const request = vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Server explanation" }, { status }),
        );
      vi.stubGlobal("fetch", request);
      await expect(uploadMediaFile(() => new FormData())).rejects.toThrow(
        "Server explanation",
      );
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("never retries an ambiguous connection failure", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Connection lost"));
    vi.stubGlobal("fetch", request);
    await expect(uploadMediaFile(() => new FormData())).rejects.toThrow(
      "Connection lost",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("handles non-JSON error responses", async () => {
    expect(
      (await mediaResponseError(new Response("gateway", { status: 502 })))
        .message,
    ).toContain("502");
  });
});
