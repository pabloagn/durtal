import { fetchOk } from "@/lib/api/external-fetch";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import { ProviderError, type ProviderAdapter, type ProviderDetail } from "./contract";

/*
 * Wikidata as a perfume provider (SLN-377). Its API is documented and its
 * data is CC0. It knows the identity of well-known perfumes: the name, the
 * brand and manufacturer, the perfumers and the launch date. It has no note
 * pyramids and no concentrations, so those stay with the person.
 */

const API = "https://www.wikidata.org/w/api.php";
const HEADERS = { "User-Agent": "Durtal personal catalogue (perfume lookup)", Accept: "application/json" };

/** The Wikidata items and properties this provider reads */
export const WIKIDATA = {
  perfume: "Q131746",
  instanceOf: "P31",
  brand: "P1716",
  manufacturer: "P176",
  perfumer: "P14539",
  inception: "P571",
  publicationDate: "P577",
} as const;

interface Claim {
  mainsnak?: { snaktype?: string; datavalue?: { value?: unknown } };
  rank?: string;
}
interface Entity {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Claim[]>;
}

async function api(params: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json", origin: "*" })}`;
  const res = await fetchOk(url, { headers: HEADERS, signal });
  const data = (await res.json()) as Record<string, unknown> & { error?: { info?: string } };
  if (data.error) throw new ProviderError(`Wikidata: ${data.error.info ?? "the request was refused"}`, "unavailable");
  return data;
}

async function entities(ids: string[], props: string, signal: AbortSignal): Promise<Entity[]> {
  if (!ids.length) return [];
  const data = await api({ action: "wbgetentities", ids: ids.slice(0, 50).join("|"), props, languages: "en" }, signal);
  return Object.values((data.entities ?? {}) as Record<string, Entity>).filter((e) => !e.missing);
}

const label = (e: Entity) => e.labels?.en?.value ?? null;
/** The values of a property, best rank first; deprecated statements are left out */
function values(e: Entity, property: string): unknown[] {
  const claims = (e.claims?.[property] ?? []).filter((c) => c.rank !== "deprecated" && c.mainsnak?.snaktype === "value");
  const preferred = claims.filter((c) => c.rank === "preferred");
  return (preferred.length ? preferred : claims).map((c) => c.mainsnak!.datavalue!.value);
}
const itemIds = (e: Entity, property: string) =>
  values(e, property)
    .map((v) => (v as { id?: string }).id)
    .filter((id): id is string => !!id && /^Q\d+$/.test(id));
const isPerfume = (e: Entity) => itemIds(e, WIKIDATA.instanceOf).includes(WIKIDATA.perfume);

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

interface Named {
  id: string;
  label: string;
}
export interface WikidataPerfumePayload {
  id: string;
  label: string | null;
  description: string | null;
  brands: Named[];
  manufacturers: Named[];
  perfumers: Named[];
  launched: unknown;
  [key: string]: unknown;
}

export const wikidataPerfumes: ProviderAdapter<"perfume"> = {
  id: "wikidata",
  label: "Wikidata",
  domain: "perfume",
  levels: ["work"],
  fields: { work: ["title", "description", "launched", "organizations", "perfumers"] },
  documentation: "https://www.wikidata.org/wiki/Wikidata:Data_access",
  needsKey: false,
  limits: { timeoutMs: 12000, minIntervalMs: 1000, maxResults: 10 },

  async search({ text }, { signal }) {
    const found = await api({ action: "wbsearchentities", search: text, language: "en", uselang: "en", type: "item", limit: "20" }, signal);
    const ids = ((found.search ?? []) as { id: string }[]).map((hit) => hit.id).filter((id) => /^Q\d+$/.test(id));
    const items = await entities(ids, "labels|descriptions|claims", signal);
    const order = new Map(ids.map((id, i) => [id, i]));
    return items
      .filter(isPerfume)
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      .map((e) => ({
        externalId: e.id,
        title: label(e) ?? e.id,
        detail: e.descriptions?.en?.value ?? null,
        url: `https://www.wikidata.org/wiki/${e.id}`,
      }));
  },

  async detail(externalId, { signal }) {
    if (!/^Q\d+$/.test(externalId)) throw new ProviderError("A Wikidata id looks like Q820507", "invalid");
    const [item] = await entities([externalId], "labels|descriptions|claims", signal);
    if (!item) throw new ProviderError(`Wikidata has no item ${externalId}`, "invalid");
    if (!isPerfume(item)) throw new ProviderError(`${label(item) ?? externalId} is not a perfume on Wikidata`, "invalid");
    const linked = [
      ...new Set([...itemIds(item, WIKIDATA.brand), ...itemIds(item, WIKIDATA.manufacturer), ...itemIds(item, WIKIDATA.perfumer)]),
    ];
    const names = new Map((await entities(linked, "labels", signal)).map((e) => [e.id, label(e)]));
    const named = (property: string) =>
      itemIds(item, property)
        .map((id) => ({ id, label: names.get(id) ?? null }))
        .filter((n): n is Named => !!n.label);
    const payload: WikidataPerfumePayload = {
      id: item.id,
      label: label(item),
      description: item.descriptions?.en?.value ?? null,
      brands: named(WIKIDATA.brand),
      manufacturers: named(WIKIDATA.manufacturer),
      perfumers: named(WIKIDATA.perfumer),
      launched: values(item, WIKIDATA.inception)[0] ?? values(item, WIKIDATA.publicationDate)[0] ?? null,
    };
    return {
      externalId: item.id,
      url: `https://www.wikidata.org/wiki/${item.id}`,
      attribution: "Wikidata",
      license: "CC0 1.0",
      payload: payload as unknown as ProviderDetail["payload"],
    };
  },

  normalize(detail) {
    const p = detail.payload as unknown as WikidataPerfumePayload;
    const fields: Record<string, unknown> = {};
    if (p.label) fields.title = p.label;
    if (p.description) fields.description = p.description;
    const launched = wikidataDate(p.launched);
    if (launched) fields.launched = launched;
    const organizations = [
      ...(p.brands ?? []).map((o) => ({ wikidataId: o.id, name: o.label, role: "brand" as const })),
      ...(p.manufacturers ?? []).map((o) => ({ wikidataId: o.id, name: o.label, role: "manufacturer" as const })),
    ];
    if (organizations.length) fields.organizations = organizations;
    if (p.perfumers?.length) fields.perfumers = p.perfumers.map((x) => ({ wikidataId: x.id, name: x.label }));
    return [{ level: "work", fields }];
  },
};
