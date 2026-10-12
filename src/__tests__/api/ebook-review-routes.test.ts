import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), apply: vi.fn(), undo: vi.fn(), context: vi.fn(),
  selectionPrepare: vi.fn(), selectionApply: vi.fn(), selectionUndo: vi.fn(),
  workPrepare: vi.fn(), workApply: vi.fn(), workUndo: vi.fn(), unlinkPrepare: vi.fn(), unlinkApply: vi.fn() }));
vi.mock("@/lib/ebooks/review/service", () => ({
  prepareEbookReview: mocks.prepare, applyEbookReview: mocks.apply,
  undoEbookReview: mocks.undo, createReviewContext: mocks.context,
}));
vi.mock("@/lib/ebooks/review/queries", () => ({ getEbookReview: vi.fn() }));
vi.mock("@/lib/ebooks/review/bulk", () => ({ prepareEbookReviewSelection: mocks.selectionPrepare,
  applyEbookReviewSelection: mocks.selectionApply, undoEbookReviewSelection: mocks.selectionUndo }));
vi.mock("@/lib/ebooks/review/work-service", () => ({ prepareWorkStatusReview: mocks.workPrepare,
  applyWorkStatusReview: mocks.workApply, undoWorkStatusReview: mocks.workUndo }));
vi.mock("@/lib/ebooks/review/unlink-service", async () => {
  // Isolate the route adapter from actual core/DB modules, as the other
  // delegates do. The request still uses its real strict validation schema.
  const { z } = await import("zod/v4");
  const { unlinkEbookSchema } = await import("@/lib/validations/ebook-review");
  return { prepareEbookUnlinkReview: mocks.unlinkPrepare, applyEbookUnlinkReview: mocks.unlinkApply,
    confirmedReviewUnlinkSchema: z.strictObject({ request: unlinkEbookSchema.extend({ action: z.literal("unlink") }),
      previewToken: z.string().regex(/^[0-9a-f]{64}$/) }) };
});
import {
  handleReviewPrepareRoute, handleReviewDecisionRoute, handleReviewUndoRoute,
  handleReviewSelectionPrepareRoute, handleReviewSelectionConfirmRoute, handleReviewSelectionUndoRoute,
  handleWorkReviewRoute, handleReviewUnlinkRoute,
} from "@/lib/api/ebook-review";
import { decisionFixture, ebookId } from "../ebooks/review/fixtures";
import { ReviewError, ReviewPreparationError } from "@/lib/ebooks/review/errors";

const params = () => Promise.resolve({ id: ebookId });
function req(body: unknown, token: string | null = "review-test-token", origin?: string) {
  return new NextRequest("http://local/api/ebooks/"+ebookId+"/state", {
    method: "POST", headers: {
      "content-type": "application/json", ...(token ? { authorization: "Bearer "+token } : {}),
      ...(origin ? { origin, host: "local" } : {}),
    }, body: JSON.stringify(body),
  });
}
describe("review REST delegates", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("DURTAL_API_TOKEN", "review-test-token"); });
  afterEach(() => vi.unstubAllEnvs());
  it("denies missing config/token/cross-site before any service context or query", async () => {
    const body = { action: "keep", ebookId };
    expect((await handleReviewPrepareRoute(req(body, null), params())).status).toBe(401);
    expect((await handleReviewPrepareRoute(req(body, "wrong"), params())).status).toBe(401);
    expect((await handleReviewPrepareRoute(req(body, "review-test-token", "http://other"), params())).status).toBe(403);
    vi.stubEnv("DURTAL_API_TOKEN", undefined);
    expect((await handleReviewPrepareRoute(req(body), params())).status).toBe(503);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("allows bearer scripts without browser origin headers and delegates exact confirmed request once", async () => {
    const request = decisionFixture().requests[0], previewToken = "0".repeat(64);
    const result = { ebookId, operation: request.operation, message: "Kept.", keptCopy: false };
    mocks.apply.mockResolvedValue(result);
    const response = await handleReviewDecisionRoute(req({ request, previewToken }), params(), ["keep"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.apply).toHaveBeenCalledWith(request, previewToken, undefined);
  });
  it("rejects invalid path, path mismatch, extra preparation fields and cross-route action before service", async () => {
    const input = decisionFixture();
    expect((await handleReviewPrepareRoute(req({ action: "keep", ebookId }),
      Promise.resolve({ id: "invalid" }))).status).toBe(400);
    expect((await handleReviewPrepareRoute(req({ action: "keep", ebookId, operation: input.requests[0].operation }), params())).status).toBe(400);
    expect((await handleReviewDecisionRoute(req({ request: input.requests[0], previewToken: "0".repeat(64) }), params(), ["link"])).status).toBe(400);
    expect((await handleReviewUndoRoute(req({ ebookId: input.requests[0].operation.operationId,
      originalOperation: input.requests[0].operation }), params())).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.undo).not.toHaveBeenCalled();
  });
  it("returns sanitized typed stale/internal errors without SQL or private data", async () => {
    const request = decisionFixture().requests[0];
    mocks.apply.mockRejectedValue(new ReviewError("stale_review", "This eBook changed."));
    const stale = await handleReviewDecisionRoute(req({ request, previewToken: "0".repeat(64) }), params(), ["keep"]);
    expect(stale.status).toBe(409);
    mocks.apply.mockRejectedValue(new Error("Failed query: private snapshot/source key"));
    const failed = await handleReviewDecisionRoute(req({ request, previewToken: "0".repeat(64) }), params(), ["keep"]);
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("snapshot");
  });
  it("protects bulk delegates before body/context and rejects unbounded/duplicate or non-core commit units", async () => {
    const intent = { action: "keep", ebookId }, request = decisionFixture().requests[0];
    expect((await handleReviewSelectionPrepareRoute(req({ intents: [intent] }, null))).status).toBe(401);
    expect((await handleReviewSelectionUndoRoute(req({}, "review-test-token", "http://other"))).status).toBe(403);
    expect((await handleReviewSelectionPrepareRoute(req({ intents: [intent, intent] }))).status).toBe(400);
    expect((await handleReviewSelectionPrepareRoute(req({ intents: Array.from({ length: 51 }, () => intent) }))).status).toBe(400);
    const other = { ...request, ebookId: "00000000-0000-4000-8000-000000000004",
      operation: { ...request.operation, operationId: "00000000-0000-4000-8000-000000000005" } };
    expect((await handleReviewSelectionConfirmRoute(req({ requests: [request, other], previewToken: "0".repeat(64) }))).status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.selectionApply).not.toHaveBeenCalled();
  });
  it("delegates bounded selection and partial Undo outcomes unchanged", async () => {
    const result = { rows: [{ status: "refused", ebookId, code: "stale_review", message: "Changed." }],
      deferredRequests: [], stopped: true };
    mocks.selectionUndo.mockResolvedValue(result);
    const request = { ebookId, originalOperation: decisionFixture().requests[0].operation };
    const response = await handleReviewSelectionUndoRoute(req({ requests: [request] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.selectionUndo).toHaveBeenCalledWith({ requests: [request] }, undefined);
  });
  it("authenticates and validates work status intent and original Undo identity before delegation", async () => {
    const input = { action: "mark_accessioned", workId: ebookId };
    expect((await handleWorkReviewRoute(req(input, null), params(), "preview")).status).toBe(401);
    expect((await handleWorkReviewRoute(req(input, "review-test-token", "http://other"), params(), "preview")).status).toBe(403);
    expect((await handleWorkReviewRoute(req({ ...input, workId: "00000000-0000-4000-8000-000000000004" }), params(), "preview")).status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled();
    mocks.workPrepare.mockResolvedValue({ request: "prepared work status" });
    const result = await handleWorkReviewRoute(req(input), params(), "preview");
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ request: "prepared work status" });
    expect(mocks.workPrepare).toHaveBeenCalledWith(input, undefined);
    mocks.workUndo.mockResolvedValue({ workId: ebookId, catalogueStatus: "tracked" });
    const undo = { workId: ebookId, originalOperation: decisionFixture().requests[0].operation };
    expect((await handleWorkReviewRoute(req(undo), params(), "undo")).status).toBe(200);
    expect(mocks.workUndo).toHaveBeenCalledWith(undo, undefined);
  });
  it("returns explicit sanitized preparation fields without serializing an internal cause", async () => {
    const issue = { ebookId, field: "authors" as const, code: "author", message: "Choose at least one author." };
    mocks.prepare.mockRejectedValue(new ReviewPreparationError([issue], { cause: new Error("Failed query: private SQL/source key") }));
    const response = await handleReviewPrepareRoute(req({ action: "accession", ebookId }), params());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Complete the highlighted choices before preparing this review.",
      code: "preparation_required", issues: [issue] });
  });
  it("protects both unlink delegates before context and validates mode/path/full request", async () => {
    const intent = { ebookId, mode: "unlink" };
    expect((await handleReviewUnlinkRoute(req(intent, null), params(), "preview")).status).toBe(401);
    expect((await handleReviewUnlinkRoute(req({}, "wrong"), params(), "confirm")).status).toBe(401);
    expect((await handleReviewUnlinkRoute(req(intent, "review-test-token", "http://other"), params(), "preview")).status).toBe(403);
    expect((await handleReviewUnlinkRoute(req({ ...intent, mode: "invented" }), params(), "preview")).status).toBe(400);
    expect((await handleReviewUnlinkRoute(req({ ...intent, rawEbookSnapshotText: "injected" }), params(), "preview")).status).toBe(400);
    expect((await handleReviewUnlinkRoute(req({ ...intent, ebookId: decisionFixture().requests[0].operation.operationId }), params(), "preview")).status).toBe(400);
    expect((await handleReviewUnlinkRoute(req({ request: decisionFixture().requests[0], previewToken: "0".repeat(64) }), params(), "confirm")).status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.unlinkPrepare).not.toHaveBeenCalled(); expect(mocks.unlinkApply).not.toHaveBeenCalled();
  });
  it("delegates automatic/fresh unlink preview and exact new decision once while ordinary routes refuse it", async () => {
    for (const mode of ["automatic_undo", "unlink"]) {
      const intent = { ebookId, mode, originalMatchingOperation: decisionFixture().requests[0].operation };
      mocks.unlinkPrepare.mockResolvedValue({ preview: { mode, keptCopy: true } });
      const response = await handleReviewUnlinkRoute(req(intent), params(), "preview");
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ preview: { mode, keptCopy: true } });
      expect(mocks.unlinkPrepare).toHaveBeenLastCalledWith(intent, undefined);
    }
    const base = decisionFixture().requests[0];
    const request = { ...base, action: "unlink", originalOperation: { ...base.operation, operationId: ebookId } };
    const transport = { request, previewToken: "0".repeat(64) }, result = { ebookId, operation: request.operation,
      keptCopy: true, message: "Returned to review. Kept the copy.", undo: { available: false, originalOperation: null } };
    mocks.unlinkApply.mockResolvedValue(result);
    const response = await handleReviewUnlinkRoute(req(transport), params(), "confirm");
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
    expect(mocks.unlinkApply).toHaveBeenCalledTimes(1); expect(mocks.unlinkApply).toHaveBeenCalledWith(transport, undefined);
    expect((await handleReviewDecisionRoute(req(transport), params(), ["link"])).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("keeps unlink stale/unknown/internal failures sanitized", async () => {
    const base = decisionFixture().requests[0];
    const transport = { request: { ...base, action: "unlink", originalOperation: base.operation }, previewToken: "0".repeat(64) };
    mocks.unlinkApply.mockRejectedValue(new ReviewError("stale_review", "This eBook changed."));
    expect((await handleReviewUnlinkRoute(req(transport), params(), "confirm")).status).toBe(409);
    mocks.unlinkApply.mockRejectedValue(new ReviewError("outcome_unknown_retry_original", "Retry the original operation."));
    expect((await handleReviewUnlinkRoute(req(transport), params(), "confirm")).status).toBe(503);
    mocks.unlinkApply.mockRejectedValue(new Error("Failed query: private raw receipt/source key"));
    const failed = await handleReviewUnlinkRoute(req(transport), params(), "confirm");
    expect(failed.status).toBe(500); expect(JSON.stringify(await failed.json())).not.toMatch(/query|receipt|source key/);
  });
});
