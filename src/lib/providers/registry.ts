import type { WorkKind } from "@/lib/catalogue/kinds";
import { adapterProblems, type ProviderAdapter, type ProviderLevel } from "./contract";

/*
 * The providers this Durtal may call (SLN-375). Each one is permitted by its
 * own documented terms; none is a scraper. A collection with no provider is
 * complete: manual entry, import and export never need one.
 */
const PROVIDERS: readonly ProviderAdapter[] = [];

for (const adapter of PROVIDERS) {
  const problems = adapterProblems(adapter);
  if (problems.length) throw new Error(`Invalid provider: ${problems.join("; ")}`);
}
if (new Set(PROVIDERS.map((p) => p.id)).size !== PROVIDERS.length) throw new Error("Two providers share an id");

/** The providers of a collection, or of one of its record levels */
export function providersFor<K extends WorkKind>(domain: K, level?: ProviderLevel<K>): ProviderAdapter<K>[] {
  return PROVIDERS.filter(
    (p): p is ProviderAdapter<K> => p.domain === domain && (!level || p.levels.some((l) => l === level)),
  );
}

export function providerById(id: string): ProviderAdapter | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}
