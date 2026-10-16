/** Structural targets for a merge: siblings, never itself or a descendant. */
export function taxonomyMergeTargets<T extends { id: string; parentId?: string | null }>(source: T, items: T[]): T[] {
  const descendants = new Set([source.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) {
      descendants.add(item.id); changed = true;
    }
  }
  return items.filter(item => !descendants.has(item.id) && (item.parentId ?? null) === (source.parentId ?? null));
}
