import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { boundedUploadJson, handleUploadCreate, handleUploadPart, uploadErrorResponse } from "@/lib/api/ebook-upload";
import { UploadAdmissionRefusal } from "@/lib/ebooks/upload/admission-refusal";
const calls = vi.hoisted(() => ({ create: vi.fn(), part: vi.fn(), token: vi.fn(() => null) }));
vi.mock("@/lib/ebooks/upload/broker", () => ({ uploadBroker: () => ({ create: calls.create, part: calls.part }) }));
vi.mock("@/lib/api/rest", () => ({ requireApiToken: calls.token }));
const id = "11111111-1111-4111-8111-111111111111";
describe("app-mode upload request boundary", () => {
  it('returns original-key evidence for the narrow stale admission refusal', async () => {
    const refusal = { status: 409 as const, code: 'generation_changed' as const, action: 'admit' as const, key: id, operationId: id, generation: 6 };
    const response = uploadErrorResponse(new UploadAdmissionRefusal(refusal));
    expect(response.status).toBe(409); expect((await response.json()).refusal).toEqual(refusal);
  });
  it("maps errors raised by another bundle's copy of the upload classes (the startup-installed client)", async () => {
    vi.resetModules();
    const other = await import("@/lib/ebooks/upload/admission-refusal");
    const { UploadError: OtherUploadError } = await import("@/lib/ebooks/upload/protocol");
    expect(other.UploadAdmissionRefusal).not.toBe(UploadAdmissionRefusal);
    const down = uploadErrorResponse(new OtherUploadError(503, "upload_unavailable", "The upload service is not running."));
    expect(down.status).toBe(503); expect(await down.json()).toEqual({ code: "upload_unavailable", error: "The upload service is not running." });
    const missing = uploadErrorResponse(new OtherUploadError(404, "upload_not_found", "Upload batch not found."));
    expect(missing.status).toBe(404);
    const refusal = { status: 409 as const, code: 'generation_changed' as const, action: 'admit' as const, key: id, operationId: id, generation: 6 };
    const refused = uploadErrorResponse(new other.UploadAdmissionRefusal(refusal));
    expect(refused.status).toBe(409); expect((await refused.json()).refusal).toEqual(refusal);
    expect(uploadErrorResponse(new Error("other")).status).toBe(503);
  });
  it("refuses cross-site requests before reading a body or invoking the broker", async () => {
    const response = await handleUploadCreate(new NextRequest("https://durtal.test/api/ebooks/uploads", { method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(403); expect(calls.create).not.toHaveBeenCalled();
  });
  it("admits the app's own page reached through any address, not only localhost (SLN-671)", async () => {
    calls.create.mockResolvedValue({ batch: id });
    // The standalone server sees its own URL as localhost; the browser used the Mac's name.
    const upload = (headers: Record<string, string>) => handleUploadCreate(new NextRequest("http://localhost:3110/api/ebooks/uploads", {
      method: "POST", headers: { Host: "durtal-mac.local:3110", "Content-Type": "application/json", ...headers }, body: "{}" }));
    expect((await upload({ "Sec-Fetch-Site": "same-origin", Origin: "http://durtal-mac.local:3110" })).status).toBe(201);
    expect((await upload({ Origin: "http://durtal-mac.local:3110" })).status).toBe(201);
    expect(calls.create).toHaveBeenNthCalledWith(1, {}, "ui");
    expect(calls.create).toHaveBeenNthCalledWith(2, {}, "ui");
    expect(calls.token).not.toHaveBeenCalled();
    expect((await upload({ Origin: "http://localhost:3110" })).status).toBe(403);
    expect((await upload({ "Sec-Fetch-Site": "same-site", Origin: "http://other.local:3110" })).status).toBe(403);
    expect(calls.create).toHaveBeenCalledTimes(2);
  });
  it("rejects excessive metadata before JSON parsing and checks its declared length", async () => {
    const request = (body: string, extra: Record<string, string> = {}) => new NextRequest("https://durtal.test/api/ebooks/uploads", {
      method: "POST", headers: { "Content-Type": "application/json", ...extra }, body,
    });
    await expect(boundedUploadJson(request(" ".repeat(65537)))).rejects.toMatchObject({ status: 413 });
    await expect(boundedUploadJson(request("{}", { "Content-Length": "3" }))).rejects.toMatchObject({ status: 400 });
    expect(await boundedUploadJson(request("{}"))).toEqual({});
  });
  it("rejects encoded/oversized parts before allocating a spool writer", async () => {
    const response = await handleUploadPart(new NextRequest(`https://durtal.test/api/ebooks/upload-operations/${id}/parts/1`, { method: "PUT",
      headers: { "Sec-Fetch-Site": "same-origin", "Content-Type": "application/octet-stream", "X-Upload-Generation": "1",
        "X-Upload-Sha256": "a".repeat(64), "Content-Length": String(8 * 1024 * 1024 + 1) }, body: "x" }), id, "1");
    expect(response.status).toBe(413); expect(calls.part).not.toHaveBeenCalled();
  });
});
