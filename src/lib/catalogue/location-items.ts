/** What a location holds, by kind (SLN-575 follow-up) */
export interface LocationItemCounts {
  /** Book copies: deleted with the location */
  copies: number;
  /** Film copies, paintings and perfume bottles: they keep a location from being deleted */
  films: number;
  paintings: number;
  perfumes: number;
}

export const NO_LOCATION_ITEMS: LocationItemCounts = { copies: 0, films: 0, paintings: 0, perfumes: 0 };

export const locationItemTotal = (c: LocationItemCounts) => c.copies + c.films + c.paintings + c.perfumes;

const KINDS = [
  ["copies", "book copy", "book copies"],
  ["films", "film copy", "film copies"],
  ["paintings", "painting", "paintings"],
  ["perfumes", "perfume bottle", "perfume bottles"],
] as const;

/** "3 book copies, 1 film copy and 2 perfume bottles", for the kinds given, leaving out any at zero */
export function describeLocationItems(
  counts: LocationItemCounts,
  kinds: readonly (keyof LocationItemCounts)[] = ["copies", "films", "paintings", "perfumes"],
): string {
  const parts = KINDS.filter(([key]) => kinds.includes(key) && counts[key] > 0).map(
    ([key, one, many]) => `${counts[key]} ${counts[key] === 1 ? one : many}`,
  );
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * A location's one count: "15 copies" when it holds only book copies, as
 * Statistics names them, one other kind by its own name ("2 paintings"), and
 * "items" for more than one kind (SLN-886)
 */
export function locationItemCount(counts: LocationItemCounts): string {
  const total = locationItemTotal(counts);
  const held = KINDS.filter(([key]) => counts[key] > 0);
  if (held.length !== 1) return `${total} ${total === 1 ? "item" : "items"}`;
  const [key, one, many] = held[0];
  return key === "copies" ? `${total} ${total === 1 ? "copy" : "copies"}` : `${total} ${total === 1 ? one : many}`;
}
