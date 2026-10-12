import type { PlanGroup } from "./plan";

/** Preserve registration order while joining every alias of one ebook. */
export function clusterGroups(groups: readonly PlanGroup[]): PlanGroup[][] {
  const owner = new Map<string, number>();
  const clusters: PlanGroup[][] = [];
  for (const group of groups) {
    const keys = [
      group.importRef ? `ref:${group.importSource}:${group.importRef}` : null,
      group.existingEbookId ? `ebook:${group.existingEbookId}` : null,
    ].filter((key): key is string => !!key);
    const found = [...new Set(
      keys.map((key) => owner.get(key)).filter((index): index is number => index !== undefined),
    )].sort((a, b) => a - b);
    const at = found.length ? found[0] : clusters.push([]) - 1;
    for (const other of found.slice(1)) {
      clusters[at].push(...clusters[other]);
      clusters[other] = [];
      for (const [key, index] of owner)
        if (index === other) owner.set(key, at);
    }
    clusters[at].push(group);
    for (const key of keys) owner.set(key, at);
  }
  return clusters.filter((cluster) => cluster.length > 0);
}
