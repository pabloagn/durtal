import type { WorkKind } from "@/lib/catalogue/kinds";
import { adapterProblems, type ProviderAdapter, type ProviderLevel } from "./contract";
import { wikidataPerfumes } from "./wikidata-perfumes";
import { wikidataFilms } from "./wikidata-films";
import { articArtworks, metArtworks } from "./museums";

/*
 * The providers this Durtal may call (SLN-375). Each one is permitted by its
 * own documented terms; none is a scraper. A collection with no provider is
 * complete: manual entry, import and export never need one.
 *
 * Perfumes: Wikidata (SLN-377). Fragrantica, Basenotes and Parfumo have no
 * public API; they are cited by hand (`src/lib/catalogue/perfume-sources.ts`).
 * Films: Wikidata (SLN-376); `src/lib/catalogue/film-sources.ts` says why not
 * TMDB, IMDb or Letterboxd. Paintings: the Art Institute of Chicago and The
 * Met (SLN-378), open APIs without a key; `src/lib/catalogue/painting-sources.ts`
 * lists the others.
 *
 * One provider can serve several collections, one adapter each: Wikidata's
 * perfumes and films share its id, so a person it names has one id here.
 */
const PROVIDERS: readonly ProviderAdapter[] = [wikidataPerfumes, wikidataFilms, articArtworks, metArtworks] as unknown as ProviderAdapter[];

for (const adapter of PROVIDERS) {
  const problems = adapterProblems(adapter);
  if (problems.length) throw new Error(`Invalid provider: ${problems.join("; ")}`);
}
if (new Set(PROVIDERS.map((p) => `${p.domain}:${p.id}`)).size !== PROVIDERS.length) throw new Error("Two providers of one collection share an id");

/** The providers of a collection, or of one of its record levels */
export function providersFor<K extends WorkKind>(domain: K, level?: ProviderLevel<K>): ProviderAdapter<K>[] {
  return PROVIDERS.filter(
    (p): p is ProviderAdapter<K> => p.domain === domain && (!level || p.levels.some((l) => l === level)),
  );
}

export function providerById(id: string, domain: WorkKind): ProviderAdapter | null {
  return PROVIDERS.find((p) => p.id === id && p.domain === domain) ?? null;
}
