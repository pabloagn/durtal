/**
 * Wikidata for publishing houses (SLN-330): search and read items through
 * the shared Action API client (src/lib/wikidata/api.ts).
 */
import { searchItems, wikidataApi, type SearchHit } from "@/lib/wikidata/api";

export { searchItems, type SearchHit };

/** The facts this enrichment reads from one item */
export interface WikidataItem {
  id: string;
  label: string | null;
  description: string | null;
  aliases: string[];
  /** P31 instance of */
  classes: string[];
  /** P279 subclass of (read for classes only) */
  superclasses: string[];
  /** P17 country */
  countries: string[];
  /** P297 ISO 3166-1 alpha-2 (country items only) */
  alpha2: string | null;
  /** P159 headquarters location */
  headquarters: string[];
  /** P571 inception and P576 dissolved, as years */
  founded: number | null;
  dissolved: number | null;
  /** P856 official website */
  websites: string[];
  /** P749 parent organization and P127 owned by */
  parents: string[];
  enwiki: string | null;
}

export interface WikidataCache {
  search: Record<string, SearchHit[]>;
  items: Record<string, WikidataItem>;
}

type Snak = { mainsnak?: { datavalue?: { value?: unknown } }; rank?: string };

function values(claims: Record<string, Snak[]> | undefined, property: string) {
  // Deprecated statements are wrong by Wikidata's own account
  return (claims?.[property] ?? [])
    .filter((s) => s.rank !== "deprecated")
    .map((s) => s.mainsnak?.datavalue?.value)
    .filter((v) => v !== undefined);
}
const ids = (claims: Record<string, Snak[]> | undefined, property: string) =>
  values(claims, property)
    .map((v) => (v as { id?: string }).id)
    .filter((v): v is string => !!v);
const year = (claims: Record<string, Snak[]> | undefined, property: string) => {
  const v = values(claims, property)[0] as
    | { time?: string; precision?: number }
    | undefined;
  // Precision 9 is a year; 10 a month; 11 a day
  if (!v?.time || (v.precision ?? 0) < 9) return null;
  const y = Number(v.time.slice(1, 5));
  return Number.isFinite(y) ? y : null;
};

/** Reads items, 50 per call; answers already cached are not read again */
export async function getItems(
  wanted: string[],
  cache: WikidataCache,
): Promise<Record<string, WikidataItem>> {
  const missing = [...new Set(wanted)].filter((id) => !cache.items[id]);
  for (let i = 0; i < missing.length; i += 50) {
    const data = await wikidataApi({
      action: "wbgetentities",
      ids: missing.slice(i, i + 50).join("|"),
      props: "labels|descriptions|aliases|claims|sitelinks",
      languages: "en|mul",
      sitefilter: "enwiki",
    });
    for (const [id, e] of Object.entries(
      (data.entities ?? {}) as Record<string, Record<string, unknown>>,
    )) {
      if ("missing" in e) continue;
      const claims = e.claims as Record<string, Snak[]> | undefined;
      // Many names now live only in "mul", the label for all languages
      const text = (field: string) => {
        const terms = e[field] as Record<string, { value: string }> | undefined;
        return terms?.en?.value ?? terms?.mul?.value ?? null;
      };
      cache.items[id] = {
        id,
        label: text("labels"),
        description: text("descriptions"),
        aliases: [
          ...new Set(
            [
              ...((e.aliases as Record<string, { value: string }[]> | undefined)?.en ?? []),
              ...((e.aliases as Record<string, { value: string }[]> | undefined)?.mul ?? []),
            ].map((a) => a.value),
          ),
        ],
        classes: ids(claims, "P31"),
        superclasses: ids(claims, "P279"),
        countries: ids(claims, "P17"),
        alpha2: (values(claims, "P297")[0] as string | undefined) ?? null,
        headquarters: ids(claims, "P159"),
        founded: year(claims, "P571"),
        dissolved: year(claims, "P576"),
        websites: values(claims, "P856").filter(
          (v): v is string => typeof v === "string",
        ),
        parents: [...ids(claims, "P749"), ...ids(claims, "P127")],
        enwiki:
          (e.sitelinks as Record<string, { title: string }> | undefined)?.enwiki
            ?.title ?? null,
      };
    }
  }
  return Object.fromEntries(wanted.map((id) => [id, cache.items[id]]).filter(([, v]) => v));
}

/**
 * Whether a class is a kind of publisher: it is one of the roots, or its
 * superclasses reach one within a few steps. Reads the classes it needs.
 */
export async function publisherClasses(
  classes: string[],
  roots: Set<string>,
  cache: WikidataCache,
  depth = 5,
): Promise<Set<string>> {
  const yes = new Set<string>();
  let frontier = new Map(classes.map((c) => [c, [c]]));
  for (let d = 0; d <= depth && frontier.size; d++) {
    await getItems([...frontier.keys()], cache);
    const next = new Map<string, string[]>();
    for (const [cls, origins] of frontier) {
      if (roots.has(cls)) {
        origins.forEach((o) => yes.add(o));
        continue;
      }
      for (const parent of cache.items[cls]?.superclasses ?? []) {
        const list = next.get(parent) ?? [];
        next.set(parent, [...list, ...origins]);
      }
    }
    frontier = next;
  }
  return yes;
}
