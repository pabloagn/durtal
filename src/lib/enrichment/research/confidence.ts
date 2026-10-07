import type { IndependentSource } from "./independence";

/*
 * researchConfidence (SLN-469, section 5). Each independent source counts
 * with its outlet weight w (a merged source takes its highest weight; a
 * publisher or translator page counts here with its own): confidence is
 * 1 - Π(1 - 0.5 w). One source of weight 1 gives 0.5, two give 0.75, three
 * 0.875. Text metrics (SLN-466) add 0.05 when they agree and take 0.05 when
 * they do not; they never create, drop, accept or reject a claim. A conflict
 * caps it at 0.3. Clamped to 0 to 1 and rounded to two decimals. These numbers
 * only order the claims: SLN-471 measures their precision.
 */

export const CONFLICT_CAP = 0.3;

export function researchConfidence(input: {
  sources: Pick<IndependentSource, "weight">[];
  conflict: boolean;
  /** The prose metrics' side against the claim's side; null when there is no support (SLN-466 not landed, or at the midpoint) */
  support?: "agrees" | "disagrees" | null;
}): number {
  let confidence = 1 - input.sources.reduce((product, s) => product * (1 - 0.5 * s.weight), 1);
  if (input.support === "agrees") confidence += 0.05;
  if (input.support === "disagrees") confidence -= 0.05;
  if (input.conflict) confidence = Math.min(confidence, CONFLICT_CAP);
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100;
}
