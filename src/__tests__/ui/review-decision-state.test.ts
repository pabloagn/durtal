import { describe, expect, it } from "vitest";
import { initialReviewDecision, reviewDecisionReducer } from "@/lib/ebooks/review-queue/decision-state";
import { preparedReview, reviewOutcome } from "../ebooks/review-ui-fixtures";

describe("review capability ownership", () => {
  const prepared = () => reviewDecisionReducer({ ...initialReviewDecision, generation: 1, phase: "preparing" },
    { type: "prepared", generation: 1, result: { ok: true, value: preparedReview() } });
  it("ignores late prepared responses after closing or changing intent", () => {
    const editing = reviewDecisionReducer(initialReviewDecision, { type: "edit", generation: 2 });
    expect(reviewDecisionReducer(editing, { type: "prepared", generation: 1, result: { ok: true, value: preparedReview() } })).toBe(editing);
  });
  it("retains the exact capability through unknown outcome and refuses edits or fresh prepares", () => {
    const original = prepared();
    const confirming = reviewDecisionReducer(original, { type: "confirm" });
    const unknown = reviewDecisionReducer(confirming, { type: "confirmed", generation: 1,
      result: { ok: false, error: { code: "outcome_unknown_retry_original", message: "Retry", retryOriginal: true } } });
    expect(unknown.phase).toBe("unknown"); expect(unknown.prepared).toBe(original.prepared);
    expect(reviewDecisionReducer(unknown, { type: "edit", generation: 2 })).toBe(unknown);
    expect(reviewDecisionReducer(unknown, { type: "prepare", generation: 2 })).toBe(unknown);
    const retry = reviewDecisionReducer(unknown, { type: "confirm" });
    expect(retry.prepared).toBe(original.prepared);
    expect(reviewDecisionReducer(retry, { type: "confirmed", generation: 1, result: { ok: true, value: reviewOutcome() } })).toMatchObject({ phase: "committed" });
  });
  it.each(["stale_review", "preview_expired", "operation_collision"] as const)("clears a refused %s preview without pretending it committed", (code) => {
    const state = reviewDecisionReducer(reviewDecisionReducer(prepared(), { type: "confirm" }),
      { type: "confirmed", generation: 1, result: { ok: false, error: { code, message: "Reload", retryOriginal: false } } });
    expect(state).toMatchObject({ phase: "failed", prepared: null, outcome: null });
  });
  it("cannot confirm without a prepared capability", () => {
    expect(reviewDecisionReducer(initialReviewDecision, { type: "confirm" })).toBe(initialReviewDecision);
  });
});
