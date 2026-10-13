/**
 * The add-to-collection picker's order (SLN-570): the collection that most
 * recently gained a member first, then the ones that never did, by name and
 * id. Only the picker uses it; every other list keeps the curated order.
 */
export function byAddRecency<T extends { id: string; name: string }>(
  rows: readonly T[],
  lastAdded: ReadonlyMap<string, number>,
): T[] {
  return [...rows].sort((a, b) => {
    const at = lastAdded.get(a.id), bt = lastAdded.get(b.id);
    if (at !== undefined || bt !== undefined) {
      if (at === undefined) return 1;
      if (bt === undefined) return -1;
      if (at !== bt) return bt - at;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
