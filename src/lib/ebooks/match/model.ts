/** Changing weights or automatic thresholds requires a new persisted model version. */
export const MATCH_MODEL = Object.freeze({
  version: 1,
  prior: -13.75,
  isbn: 21.3,
  identifier: 19.9,
  title: { exact: 12.4, similar: 7.6, partial: 2.3, disagree: -2.7 },
  author: { identity: 11.4, compatible: 7.2, disagree: -4.6, missing: 0 },
  language: { agrees: 0.8, disagrees: -1.7, missing: 0 },
  seriesPosition: 10.6,
  thresholds: { strong: 0.99, likely: 0.9, candidate: 0.3, margin: 5 },
});
export function probabilityForBits(bits: number): number {
  // Avoid Infinity / Infinity when a future model raises weights.
  return 1 / (1 + 2 ** -bits);
}
