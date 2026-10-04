import type { WorkKind } from "./kinds";

/**
 * Typed, directed links between two works. The link reads from its first
 * work: "this film is an adaptation of that book". Similarity never creates
 * one; each is recorded by hand, and an inspiration needs a source.
 */
export const WORK_RELATION_TYPES = [
  "adaptation",
  "remake",
  "flanker",
  "inspiration",
] as const;
export type WorkRelationType = (typeof WORK_RELATION_TYPES)[number];

/**
 * What each type joins, as [from kind, to kind] pairs; null means any kind.
 * The database check `work_relation_pair_check` holds the same pairs.
 */
export const WORK_RELATION_PAIRS: Record<
  WorkRelationType,
  readonly (readonly [WorkKind, WorkKind])[] | null
> = {
  // A film adapted from a book; a book adapted from a film (a novelization)
  adaptation: [
    ["film", "book"],
    ["book", "film"],
  ],
  remake: [["film", "film"]],
  flanker: [["perfume", "perfume"]],
  inspiration: null,
};

/** How a link reads from each end: the first work's view and the second's */
export const WORK_RELATION_LABELS: Record<
  WorkRelationType,
  { outgoing: string; incoming: string }
> = {
  adaptation: { outgoing: "Adapted from", incoming: "Adapted as" },
  remake: { outgoing: "Remake of", incoming: "Remade as" },
  flanker: { outgoing: "Flanker of", incoming: "Flankers" },
  inspiration: { outgoing: "Inspired by", incoming: "Inspired" },
};

/** An inspiration is a claim about influence: it always cites a source */
export function relationNeedsSource(type: WorkRelationType) {
  return type === "inspiration";
}

/** The kinds the other end may be, for a link from (`outgoing`) or to a work of `kind` */
export function relationTargetKinds(
  type: WorkRelationType,
  kind: WorkKind,
  direction: "outgoing" | "incoming",
  enabled: readonly WorkKind[],
): WorkKind[] {
  const pairs = WORK_RELATION_PAIRS[type];
  if (!pairs) return [...enabled];
  return pairs
    .filter(([from, to]) => (direction === "outgoing" ? from : to) === kind)
    .map(([from, to]) => (direction === "outgoing" ? to : from))
    .filter((k) => enabled.includes(k));
}

/** Whether a link of `type` may join a work of `from` kind to one of `to` kind */
export function relationAllowed(type: WorkRelationType, from: WorkKind, to: WorkKind) {
  const pairs = WORK_RELATION_PAIRS[type];
  return !pairs || pairs.some(([f, t]) => f === from && t === to);
}
