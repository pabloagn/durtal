import { ProviderError, type ProviderAdapter, type ProviderDetail } from "./contract";
import {
  entityLabel as label,
  providerUserAgent,
  wikidataApi,
  wikidataDate,
  wikidataEntities,
  wikidataItemIds as itemIds,
  wikidataValues as values,
  type WikidataEntity as Entity,
} from "./wikidata";

export { wikidataDate };

/*
 * Wikidata as a perfume provider (SLN-377). Its API is documented and its
 * data is CC0. It knows the identity of well-known perfumes: the name, the
 * brand and manufacturer, the perfumers and the launch date. It has no note
 * pyramids and no concentrations, so those stay with the person.
 */

const userAgent = () => providerUserAgent("perfume lookup");
const api = (params: Record<string, string>, signal: AbortSignal) => wikidataApi(params, userAgent(), signal);
const entities = (ids: string[], props: string, signal: AbortSignal) => wikidataEntities(ids, props, userAgent(), signal);

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

const isPerfume = (e: Entity) => itemIds(e, WIKIDATA.instanceOf).includes(WIKIDATA.perfume);

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
