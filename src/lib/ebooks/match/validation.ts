/** Persisted and proposed probabilities share one boundary. NaN compares
 * unusually in PostgreSQL, so neither JavaScript nor SQL relies only on range. */
export function requireMatchProbability(value: number | null): void {
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1))
    throw new Error(
      "Match probability must be null or a finite value from 0 to 1",
    );
}
export function requireFiniteScore(
  weightBits: number,
  marginBits: number | null,
): void {
  if (
    !Number.isFinite(weightBits) ||
    (marginBits !== null && !Number.isFinite(marginBits))
  )
    throw new Error("Match weight and margin must be finite");
}
