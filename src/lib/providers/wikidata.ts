import { ExternalFetchError, fetchOk } from "@/lib/api/external-fetch";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import { ProviderError } from "./contract";

/*
 * Reading Wikidata (SLN-377, SLN-376): its documented API, no key, CC0 data.
 * The perfume and film providers share these calls; each sends its own
 * User-Agent, as Wikidata's policy asks.
 */

const API = "https://www.wikidata.org/w/api.php";

/** A lookup's User-Agent, with the ENRICHMENT_CONTACT contact when it is set (read at each call) */
export function providerUserAgent(lookup: string): string {
  const contact = process.env.ENRICHMENT_CONTACT?.trim();
  return `Durtal personal catalogue (${contact ? `${lookup}; ${contact}` : lookup})`;
}

export interface WikidataClaim {
  mainsnak?: { snaktype?: string; datavalue?: { value?: unknown } };
  rank?: string;
  qualifiers?: Record<string, { snaktype?: string; datavalue?: { value?: unknown } }[]>;
}
export interface WikidataEntity {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, WikidataClaim[]>;
}

export async function wikidataApi(params: Record<string, string>, userAgent: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json", origin: "*" })}`;
  const res = await fetchOk(url, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal });
  const data = (await res.json()) as Record<string, unknown> & { error?: { info?: string } };
  if (data.error) throw new ProviderError(`Wikidata: ${data.error.info ?? "the request was refused"}`, "unavailable");
  return data;
}

/** Items by id, 50 to a call (the API's limit); missing items are left out */
export async function wikidataEntities(ids: string[], props: string, userAgent: string, signal: AbortSignal, { max = 50 } = {}): Promise<WikidataEntity[]> {
  const wanted = [...new Set(ids)].slice(0, max);
  const found: WikidataEntity[] = [];
  for (let i = 0; i < wanted.length; i += 50) {
    const data = await wikidataApi({ action: "wbgetentities", ids: wanted.slice(i, i + 50).join("|"), props, languages: "en|mul" }, userAgent, signal);
    found.push(...Object.values((data.entities ?? {}) as Record<string, WikidataEntity>).filter((e) => !e.missing));
  }
  return found;
}

// Many names now live only in "mul", the label for all languages
export const entityLabel = (e: WikidataEntity) => e.labels?.en?.value ?? e.labels?.mul?.value ?? null;

/**
 * A property's statements with a value, deprecated ones left out: the
 * preferred ones when there are any, or with `all`, every one in its order
 * (a cast, the release dates of each country)
 */
export function wikidataStatements(e: WikidataEntity, property: string, { all = false } = {}): WikidataClaim[] {
  const claims = (e.claims?.[property] ?? []).filter((c) => c.rank !== "deprecated" && c.mainsnak?.snaktype === "value");
  const preferred = claims.filter((c) => c.rank === "preferred");
  return preferred.length && !all ? preferred : claims;
}

/** The values of a property, best rank first */
export const wikidataValues = (e: WikidataEntity, property: string): unknown[] => wikidataStatements(e, property).map((c) => c.mainsnak!.datavalue!.value);

/**
 * One property's values on each of some items, a `wbgetclaims` call per item:
 * a country's or a language's code without its whole claims, which run to
 * megabytes for a country. A few calls run at once. An item that does not
 * answer has no values; a rate limit or timeout stops the lookup.
 */
export async function wikidataPropertyValues(
  ids: string[],
  property: string,
  userAgent: string,
  signal: AbortSignal,
  { parallel = 4 } = {},
): Promise<Map<string, unknown[]>> {
  const found = new Map<string, unknown[]>();
  const queue = [...new Set(ids)];
  let stopped = false;
  const next = async (): Promise<void> => {
    if (stopped) return;
    const id = queue.shift();
    if (!id) return;
    try {
      const data = await wikidataApi({ action: "wbgetclaims", entity: id, property, props: "" }, userAgent, signal);
      found.set(id, wikidataValues({ id, claims: data.claims as WikidataEntity["claims"] }, property));
    } catch (error) {
      if (signal.aborted || (error instanceof ExternalFetchError && (error.timedOut || error.status === 429))) {
        stopped = true;
        throw error;
      }
    }
    return next();
  };
  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, next));
  return found;
}

/** The item ids a value or a qualifier names */
export const itemId = (value: unknown) => {
  const id = (value as { id?: string } | null)?.id;
  return id && /^Q\d+$/.test(id) ? id : null;
};
export const wikidataItemIds = (e: WikidataEntity, property: string) =>
  wikidataValues(e, property)
    .map(itemId)
    .filter((id): id is string => !!id);

/** The values of one qualifier of a statement */
export const qualifierValues = (claim: WikidataClaim, property: string): unknown[] =>
  (claim.qualifiers?.[property] ?? []).filter((q) => q.snaktype === "value").map((q) => q.datavalue?.value);

/** A Wikidata time as a catalogue date; a decade becomes a range, coarser times are dropped */
export function wikidataDate(value: unknown): CatalogueDateInput | null {
  const { time, precision } = (value ?? {}) as { time?: string; precision?: number };
  const match = /^\+(\d{1,4})-(\d{2})-(\d{2})T/.exec(time ?? "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (precision === 11 && month && day) return { precision: "day", start: { year, month, day } };
  if (precision === 10 && month) return { precision: "month", start: { year, month } };
  if (precision === 9) return { precision: "year", start: { year } };
  if (precision === 8) return { precision: "range", start: { year: year - (year % 10) }, end: { year: year - (year % 10) + 9 } };
  return null;
}
