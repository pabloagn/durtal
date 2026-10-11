/** Each group is replaced as one full-state diff. A page turn reads a section
 * bucket rather than scanning a book; overlapping groups have separate keys. */
export interface IndexedDecoration {
  id: string;
  sectionIndex: number;
  signature: string;
}
export const decorationKey = (group: string, id: string) =>
  JSON.stringify([group, id]);
export class DecorationsIndex<T extends IndexedDecoration> {
  #groups = new Map<string, Map<string, T>>();
  #sections = new Map<number, Map<string, { group: string; item: T }>>();
  set(group: string, items: readonly T[]) {
    const next = new Map<string, T>();
    for (const item of items) {
      if (next.has(item.id))
        throw new Error("Duplicate decoration id in group");
      if (!Number.isSafeInteger(item.sectionIndex) || item.sectionIndex < 0)
        throw new Error("Invalid decoration section");
      next.set(item.id, item);
    }
    const previous = this.#groups.get(group) ?? new Map<string, T>();
    const changed = new Set<number>();
    for (const [id, item] of previous) {
      const replacement = next.get(id);
      if (
        replacement?.signature === item.signature &&
        replacement.sectionIndex === item.sectionIndex
      )
        continue;
      const bucket = this.#sections.get(item.sectionIndex);
      bucket?.delete(decorationKey(group, id));
      if (!bucket?.size) this.#sections.delete(item.sectionIndex);
      changed.add(item.sectionIndex);
    }
    for (const [id, item] of next) {
      const old = previous.get(id);
      if (
        old?.signature === item.signature &&
        old.sectionIndex === item.sectionIndex
      )
        continue;
      const bucket = this.#sections.get(item.sectionIndex) ?? new Map();
      bucket.set(decorationKey(group, id), { group, item });
      this.#sections.set(item.sectionIndex, bucket);
      changed.add(item.sectionIndex);
    }
    if (next.size) this.#groups.set(group, next);
    else this.#groups.delete(group);
    return changed;
  }
  section(index: number): ReadonlyMap<string, { group: string; item: T }> {
    return this.#sections.get(index) ?? new Map();
  }
  clear() {
    this.#groups.clear();
    this.#sections.clear();
  }
}
