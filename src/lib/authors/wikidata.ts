/**
 * Wikidata for people (author enrichment): the facts read from a person, a
 * place and any other item, and the works a person wrote. Built on the
 * shared Action API client (src/lib/wikidata/api.ts). Only the facts used
 * are kept in the cache, never whole items, and images (P18) are never read.
 */
import {
  bestStatements,
  currentStatements,
  qualifierIds,
  reconcileNames,
  searchItems,
  searchTerms,
  sparqlSelect,
  statementIds,
  statementStrings,
  wikidataApi,
  type Claims,
  type ReconcileHit,
  type SearchHit,
  type Statement,
  type TermHit,
} from "@/lib/wikidata/api";

export { searchItems, searchTerms, type SearchHit, type TermHit };

/** A Wikidata time value. The year is civil: negative before Christ, never 0 */
export interface WikidataTime {
  year: number;
  month: number | null;
  day: number | null;
  /** 11 day, 10 month, 9 year, 8 decade, 7 century, lower is coarser */
  precision: number;
  julian: boolean;
  /** Qualified as circa, presumably or disputed, or given as a range */
  circa: boolean;
}

export interface PersonItem {
  id: string;
  label: string | null;
  description: string | null;
  aliases: string[];
  /** P31 instance of */
  classes: string[];
  /** P21 sex or gender */
  genders: string[];
  /** P569 and P570, best rank */
  births: WikidataTime[];
  deaths: WikidataTime[];
  /** P19 and P20 */
  birthPlaces: string[];
  deathPlaces: string[];
  /** P27 country of citizenship */
  citizenships: string[];
  /** P106 occupation */
  occupations: string[];
  /** P1477 birth name, with its language */
  birthNames: { text: string; language: string }[];
  /** P648 Open Library and P2963 Goodreads author ids */
  openLibrary: string[];
  goodreads: string[];
  /** P856 official website */
  websites: string[];
  /** P800 notable work and P135 movement */
  notableWorks: string[];
  movements: string[];
  enwiki: string | null;
}

export interface PlaceItem {
  id: string;
  label: string | null;
  description: string | null;
  /** P31 instance of */
  classes: string[];
  /** P17 country, today's when Wikidata dates them */
  countries: string[];
  /** P297, for country items */
  alpha2: string | null;
  /** P576 dissolved, as a year: a country that no longer exists */
  dissolved: number | null;
  /** P625 */
  coordinates: { latitude: number; longitude: number } | null;
  /** P131 located in the administrative unit, today's first */
  within: string[];
}

/** Any other item, read for its English label only */
export interface LabelItem {
  id: string;
  label: string | null;
  description: string | null;
}

export interface WorkHit {
  id: string;
  label: string | null;
  aliases: string[];
}

export interface AuthorWikidataCache {
  /** 2: names read in English and "mul" */
  version?: number;
  search: Record<string, SearchHit[]>;
  humans: Record<string, TermHit[]>;
  /** People found for a name by the reconciliation service */
  reconcile: Record<string, ReconcileHit[]>;
  works: Record<string, WorkHit[]>;
  people: Record<string, PersonItem | null>;
  places: Record<string, PlaceItem | null>;
  labels: Record<string, LabelItem | null>;
  /** HTTP status of each official website when it was checked; 0 when it did not answer */
  sites?: Record<string, number>;
}

export const emptyAuthorCache = (): AuthorWikidataCache => ({
  version: 2,
  search: {},
  humans: {},
  reconcile: {},
  works: {},
  people: {},
  places: {},
  labels: {},
});

// Q5727902 circa, Q18122778 presumably, Q18912752 disputed
const UNCERTAIN = new Set(["Q5727902", "Q18122778", "Q18912752"]);
const JULIAN = "http://www.wikidata.org/entity/Q1985786";

export function parseTime(s: Statement): WikidataTime | null {
  const v = s.mainsnak?.datavalue?.value as
    | { time?: string; precision?: number; calendarmodel?: string }
    | undefined;
  const m = v?.time?.match(/^([+-])(\d+)-(\d\d)-(\d\d)T/);
  if (!m || v?.precision === undefined) return null;
  // The JSON year is civil: -0044 is 44 BC, and there is no year 0
  const year = (m[1] === "-" ? -1 : 1) * Number(m[2]);
  if (!year) return null;
  const precision = v.precision;
  const month = precision >= 10 && Number(m[3]) ? Number(m[3]) : null;
  const day = precision >= 11 && month && Number(m[4]) ? Number(m[4]) : null;
  const circa =
    qualifierIds(s, "P1480").some((q) => UNCERTAIN.has(q)) ||
    !!s.qualifiers?.P1319?.length ||
    !!s.qualifiers?.P1326?.length;
  return { year, month, day, precision, julian: v.calendarmodel === JULIAN, circa };
}

const times = (claims: Claims, property: string) =>
  bestStatements(claims, property)
    .map(parseTime)
    .filter((t): t is WikidataTime => !!t);

type Entity = Record<string, unknown>;
// Many names now live only in "mul", the label for all languages
const text = (e: Entity, field: string) => {
  const terms = e[field] as Record<string, { value: string }> | undefined;
  return terms?.en?.value ?? terms?.mul?.value ?? null;
};
const aliasesOf = (e: Entity) => {
  const terms = e.aliases as Record<string, { value: string }[]> | undefined;
  return [...new Set([...(terms?.en ?? []), ...(terms?.mul ?? [])].map((a) => a.value))];
};

function readPerson(id: string, e: Entity): PersonItem {
  const claims = e.claims as Claims;
  const best = (p: string) => bestStatements(claims, p);
  return {
    id,
    label: text(e, "labels"),
    description: text(e, "descriptions"),
    aliases: aliasesOf(e),
    classes: statementIds(best("P31")),
    genders: statementIds(best("P21")),
    births: times(claims, "P569"),
    deaths: times(claims, "P570"),
    birthPlaces: statementIds(best("P19")),
    deathPlaces: statementIds(best("P20")),
    citizenships: statementIds(best("P27")),
    occupations: statementIds(best("P106")),
    birthNames: best("P1477")
      .map((s) => s.mainsnak?.datavalue?.value as { text?: string; language?: string })
      .filter((v) => !!v?.text)
      .map((v) => ({ text: v.text!, language: v.language ?? "" })),
    openLibrary: statementStrings(best("P648")),
    goodreads: statementStrings(best("P2963")),
    websites: statementStrings(best("P856")),
    notableWorks: statementIds(best("P800")),
    movements: statementIds(best("P135")),
    enwiki:
      (e.sitelinks as Record<string, { title: string }> | undefined)?.enwiki?.title ?? null,
  };
}

function readPlace(id: string, e: Entity): PlaceItem {
  const claims = e.claims as Claims;
  const coord = bestStatements(claims, "P625")[0]?.mainsnak?.datavalue?.value as
    | { latitude?: number; longitude?: number }
    | undefined;
  const dissolved = times(claims, "P576")[0]?.year ?? null;
  return {
    id,
    label: text(e, "labels"),
    description: text(e, "descriptions"),
    classes: statementIds(bestStatements(claims, "P31")),
    countries: statementIds(currentStatements(bestStatements(claims, "P17"))),
    alpha2: statementStrings(bestStatements(claims, "P297"))[0] ?? null,
    dissolved,
    coordinates:
      typeof coord?.latitude === "number" && typeof coord?.longitude === "number"
        ? { latitude: coord.latitude, longitude: coord.longitude }
        : null,
    within: statementIds(currentStatements(bestStatements(claims, "P131"))),
  };
}

const readLabel = (id: string, e: Entity): LabelItem => ({
  id,
  label: text(e, "labels"),
  description: text(e, "descriptions"),
});

/** Reads items 50 per call into one part of the cache; a missing item is kept as null */
async function readItems<T>(
  wanted: string[],
  store: Record<string, T | null>,
  props: string,
  read: (id: string, e: Entity) => T,
) {
  const missing = [...new Set(wanted)].filter((id) => /^Q\d+$/.test(id) && !(id in store));
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const data = await wikidataApi({
      action: "wbgetentities",
      ids: batch.join("|"),
      props,
      languages: "en|mul",
      sitefilter: "enwiki",
    });
    const entities = (data.entities ?? {}) as Record<string, Entity>;
    for (const id of batch) {
      const e = entities[id];
      // A redirect answers under its target's id; it is read again by that id
      store[id] = e && !("missing" in e) ? read(id, e) : null;
    }
  }
}

export const getPeople = (ids: string[], cache: AuthorWikidataCache) =>
  readItems(ids, cache.people, "labels|descriptions|aliases|claims|sitelinks", readPerson);

export const getPlaces = (ids: string[], cache: AuthorWikidataCache) =>
  readItems(ids, cache.places, "labels|descriptions|claims", readPlace);

export const getLabels = (ids: string[], cache: AuthorWikidataCache) =>
  readItems(ids, cache.labels, "labels|descriptions", readLabel);

/**
 * The works Wikidata credits to a person (P50 author), most notable first.
 * Scholarly articles and editions are left out.
 */
export async function worksBy(id: string, cache: AuthorWikidataCache): Promise<WorkHit[]> {
  if (cache.works[id]) return cache.works[id];
  const hits = await searchTerms(
    `haswbstatement:P50=${id} -haswbstatement:P31=Q13442814 -haswbstatement:P31=Q3331189`,
    {},
    50,
  );
  cache.works[id] = hits;
  return hits;
}

/** Humans whose name matches the text, best match first */
export async function searchHumans(name: string, cache: AuthorWikidataCache) {
  return searchTerms(`${name} haswbstatement:P31=Q5`, cache.humans, 20);
}

/** Humans for many names at once, through the reconciliation service */
export const reconcileHumans = (names: string[], cache: AuthorWikidataCache) =>
  reconcileNames(names, "Q5", cache.reconcile);

const TITLE_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "mul"];

/**
 * The works Wikidata credits to many people (P50 author), 80 people per
 * query, with their titles in the languages the catalogue's books use.
 * Scholarly articles are left out. A query that fails is split in two.
 */
export async function worksByMany(ids: string[], cache: AuthorWikidataCache): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => /^Q\d+$/.test(id) && !cache.works[id]);
  const run = async (batch: string[]): Promise<void> => {
    let rows: Record<string, string>[];
    try {
      rows = await sparqlSelect(`SELECT ?author ?work ?label WHERE {
        VALUES ?author { ${batch.map((id) => `wd:${id}`).join(" ")} }
        ?work wdt:P50 ?author .
        FILTER NOT EXISTS { ?work wdt:P31 wd:Q13442814 }
        ?work rdfs:label ?label .
        FILTER(LANG(?label) IN (${TITLE_LANGUAGES.map((l) => `"${l}"`).join(", ")}))
      }`);
    } catch (err) {
      if (batch.length === 1) throw err;
      console.error(`[wikidata] works query for ${batch.length} people failed; splitting it`);
      await run(batch.slice(0, batch.length / 2));
      await run(batch.slice(batch.length / 2));
      return;
    }
    const byAuthor = new Map<string, Map<string, string[]>>(batch.map((id) => [id, new Map()]));
    for (const r of rows) {
      const author = r.author.split("/").pop()!;
      const work = r.work.split("/").pop()!;
      const titles = byAuthor.get(author)?.get(work) ?? [];
      byAuthor.get(author)?.set(work, [...titles, r.label]);
    }
    for (const [author, works] of byAuthor)
      cache.works[author] = [...works].map(([id, titles]) => ({
        id,
        label: titles[0] ?? null,
        aliases: [...new Set(titles.slice(1))],
      }));
  };
  for (let i = 0; i < missing.length; i += 80) await run(missing.slice(i, i + 80));
}
