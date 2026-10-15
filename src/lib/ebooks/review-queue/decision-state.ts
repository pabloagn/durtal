import type { PreparedReview, ReviewOutcome, ReviewUiResult, ReviewPreparationIssue } from "./types";

export interface ReviewDecisionState {
  generation: number; phase: "editing" | "preparing" | "prepared" | "confirming" | "unknown" | "failed" | "committed";
  prepared: PreparedReview | null; error: string | null; outcome: ReviewOutcome | null;
  issues: readonly ReviewPreparationIssue[];
  /** The confirmation running now retries an unknown outcome: its button keeps saying so */
  retrying?: boolean;
}
export const initialReviewDecision: ReviewDecisionState = {
  generation: 0, phase: "editing", prepared: null, error: null, outcome: null, issues: [],
};
export type ReviewDecisionEvent =
  | { type: "prepare"; generation: number }
  | { type: "prepared"; generation: number; result: ReviewUiResult<PreparedReview> }
  | { type: "confirm" }
  | { type: "confirmed"; generation: number; result: ReviewUiResult<ReviewOutcome> }
  | { type: "edit"; generation: number };
/** The original capability survives every uncertain write; a late preview cannot replace it. */
export function reviewDecisionReducer(state: ReviewDecisionState, event: ReviewDecisionEvent): ReviewDecisionState {
  if (event.type === "edit") {
    if (state.phase === "confirming" || state.phase === "unknown") return state;
    return { ...initialReviewDecision, generation: event.generation };
  }
  if (event.type === "prepare") {
    if (state.phase === "confirming" || state.phase === "unknown") return state;
    return { ...initialReviewDecision, generation: event.generation, phase: "preparing" };
  }
  if (event.type === "confirm") return state.prepared && ["prepared", "unknown"].includes(state.phase)
    ? { ...state, phase: "confirming", error: null, retrying: state.phase === "unknown" } : state;
  if (event.generation !== state.generation) return state;
  if (event.type === "prepared") {
    if (state.phase !== "preparing") return state;
    return event.result.ok
      ? { ...state, phase: "prepared", prepared: event.result.value, error: null }
      : { ...state, phase: "failed", error: event.result.error.message, issues: event.result.error.issues ?? [] };
  }
  if (state.phase !== "confirming") return state;
  if (event.result.ok) return { ...state, phase: "committed", outcome: event.result.value, error: null };
  return { ...state, phase: event.result.error.retryOriginal ? "unknown" : "failed",
    prepared: event.result.error.retryOriginal ? state.prepared : null, error: event.result.error.message };
}
