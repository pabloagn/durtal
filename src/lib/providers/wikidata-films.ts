import { fetchOk } from "@/lib/api/external-fetch";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import type { FilmImage } from "@/lib/catalogue/film-sources";
import { ProviderError, type ProviderAdapter, type ProviderDetail } from "./contract";

export type { FilmImage };
import {
  entityLabel as label,
  itemId,
  providerUserAgent,
  qualifierValues,
  wikidataApi,
  wikidataDate,
  wikidataEntities,
  wikidataItemIds as itemIds,
  wikidataPropertyValues as propertyValues,
  wikidataStatements as statements,
  wikidataValues as values,
  type WikidataEntity as Entity,
} from "./wikidata";

/*
 * Wikidata as a film provider (SLN-376). Its API is documented, needs no key
 * and its data is CC0. It knows a film's identity (titles, the first release,
 * countries and original languages with their ISO codes, running time, its
 * IMDb, TMDb and Letterboxd ids), its makers and cast in its editors' order,
 * its production companies, and its release dates per country or festival
 * (each place with its country code when it has one). Its cast lists are often
 * partial, and it never says how a film was released, so nothing it says is
 * taken as complete. A poster or still is read from Wikimedia Commons with
 * the author and license Commons gives.
 */

const userAgent = () => providerUserAgent("film lookup");
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const api = (params: Record<string, string>, signal: AbortSignal) => wikidataApi(params, userAgent(), signal);

/** The Wikidata properties this provider reads */
export const WIKIDATA_FILM = {
  instanceOf: "P31",
  title: "P1476",
  publicationDate: "P577",
  placeOfPublication: "P291",
  countryOfOrigin: "P495",
  originalLanguage: "P364",
  duration: "P2047",
  productionCompany: "P272",
  imdb: "P345",
  tmdb: "P4947",
  letterboxd: "P6127",
  poster: "P3383",
  image: "P18",
  characterRole: "P453",
  characterName: "P4633",
  ordinal: "P1545",
  /** On a country or a release's place: ISO 3166-1 alpha-2 */
  countryCode: "P297",
  /** On a language: ISO 639-1, else ISO 639-3 */
  languageCode: "P218",
  languageCode3: "P220",
} as const;

/** The classes Wikidata files films under (P31), feature to short, live to animated */
export const FILM_CLASSES: ReadonlySet<string> = new Set([
  "Q11424", // film
  "Q24869", // feature film
  "Q24862", // short film
  "Q506240", // television film
  "Q202866", // animated film
  "Q29168811", // animated feature film
  "Q20650540", // anime film
  "Q93204", // documentary film
  "Q226730", // silent film
  "Q1257444", // film adaptation
  "Q17123180", // sequel film
]);

/** Wikidata's credit properties, in the order a film's credits run, and the role each one is here */
export const FILM_CREDIT_PROPERTIES = [
  ["P57", "film.director"],
  ["P58", "film.screenwriter"],
  ["P161", "film.cast"],
  ["P162", "film.producer"],
  ["P344", "film.cinematographer"],
  ["P1040", "film.editor"],
  ["P86", "film.composer"],
  ["P2554", "film.production_designer"],
  ["P2515", "film.costume_designer"],
] as const;
export type FilmCreditRole = (typeof FILM_CREDIT_PROPERTIES)[number][1];

/** Wikidata's units of time, in seconds */
const SECONDS = { Q7727: 60, Q11574: 1, Q25235: 3600 } as Record<string, number>;
/** At most this many people, characters, places and companies are named for one film */
const MAX_LINKED = 400;
/** At most this many countries, languages and release places have their codes read, a call each, in that order */
const MAX_CODED = 40;

interface Named {
  id: string;
  label: string;
}
/** A country or a release's place, with its ISO 3166-1 alpha-2 code when Wikidata states one */
type Place = Named & { alpha2: string | null };
/** A language, with its ISO 639-1 and 639-3 codes when Wikidata states them */
type Language = Named & { iso6391: string | null; iso6393: string | null };
export interface WikidataFilmPayload {
  id: string;
  label: string | null;
  /** The title in its own language (P1476), when Wikidata has one */
  title: { text: string; language: string } | null;
  description: string | null;
  /** Each publication date, with the country or festival it names */
  releases: { date: unknown; place: Place | null }[];
  countries: Place[];
  languages: Language[];
  /** Running times in seconds, in Wikidata's order */
  runtimes: number[];
  /** Cast and crew in credit order; a person may hold several roles */
  credits: { role: FilmCreditRole; person: Named; characters: string[] }[];
  /** Credits whose person has no English name on Wikidata, left out */
  unnamedCredits: number;
  companies: Named[];
  identifiers: { imdb: string | null; tmdb: string | null; letterboxd: string | null };
  image: FilmImage | null;
  [key: string]: unknown;
}

const isFilm = (e: Entity) => itemIds(e, WIKIDATA_FILM.instanceOf).some((id) => FILM_CLASSES.has(id));

/** The earliest of some Wikidata times */
export function earliestDate(times: unknown[]): CatalogueDateInput | null {
  const dates = times.map(wikidataDate).filter((d): d is CatalogueDateInput => !!d);
  const key = (d: CatalogueDateInput) => [d.start?.year ?? 0, d.start?.month ?? 0, d.start?.day ?? 0];
  dates.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return dates[0] ?? null;
}

/** A code's value when it has the code's form */
const code = (value: unknown, form: RegExp) => (typeof value === "string" && form.test(value.trim()) ? value.trim() : null);

/**
 * The ISO codes of a film's countries, release places and languages, which
 * match Durtal's lists where the English names differ ("United States" for
 * "United States of America"). A language without a 639-1 code is asked for
 * its 639-3 code. Past the cap, a name is matched by itself.
 */
async function isoCodes(countryIds: string[], languageIds: string[], releasePlaceIds: string[], signal: AbortSignal) {
  const coded = new Set([...new Set([...countryIds, ...languageIds, ...releasePlaceIds])].slice(0, MAX_CODED));
  const spoken = languageIds.filter((id) => coded.has(id));
  const places = [...coded].filter((id) => !spoken.includes(id));
  const alpha2 = await propertyValues(places, WIKIDATA_FILM.countryCode, userAgent(), signal);
  const iso1 = await propertyValues(spoken, WIKIDATA_FILM.languageCode, userAgent(), signal);
  const without = spoken.filter((id) => !(iso1.get(id) ?? []).some((v) => code(v, /^[a-z]{2}$/)));
  const iso3 = await propertyValues(without, WIKIDATA_FILM.languageCode3, userAgent(), signal);
  const first = (found: Map<string, unknown[]>, id: string, form: RegExp) => (found.get(id) ?? []).map((v) => code(v, form)).find(Boolean) ?? null;
  return {
    place: (n: Named): Place => ({ ...n, alpha2: first(alpha2, n.id, /^[A-Z]{2}$/) }),
    language: (n: Named): Language => ({ ...n, iso6391: first(iso1, n.id, /^[a-z]{2}$/), iso6393: first(iso3, n.id, /^[a-z]{3}$/) }),
  };
}

/** A running time in seconds, from a Wikidata quantity */
function seconds(value: unknown) {
  const { amount, unit } = (value ?? {}) as { amount?: string; unit?: string };
  const per = SECONDS[String(unit ?? "").split("/").pop() ?? ""];
  const n = Number(amount);
  return per && Number.isFinite(n) && n > 0 ? Math.round(n * per) : null;
}

/** The text of an HTML fragment, as Commons writes an author */
function plainText(html: string | undefined | null) {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/** A Commons file's address and terms; null when Commons does not answer for it */
async function commonsImage(file: string, kind: FilmImage["kind"], signal: AbortSignal): Promise<FilmImage | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
    titles: `File:${file}`,
  });
  try {
    const res = await fetchOk(`${COMMONS_API}?${params}`, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal });
    const data = (await res.json()) as {
      query?: { pages?: Record<string, { imageinfo?: { url?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }[] }> };
    };
    const info = Object.values(data.query?.pages ?? {})[0]?.imageinfo?.[0];
    if (!info?.url?.startsWith("https://") || !info.descriptionurl?.startsWith("https://")) return null;
    const meta = info.extmetadata ?? {};
    const licenseUrl = plainText(meta.LicenseUrl?.value);
    return {
      file,
      kind,
      url: info.url,
      page: info.descriptionurl,
      credit: plainText(meta.Artist?.value),
      license: plainText(meta.LicenseShortName?.value),
      licenseUrl: licenseUrl?.startsWith("https://") || licenseUrl?.startsWith("http://") ? licenseUrl : null,
    };
  } catch (error) {
    // The film still comes back without its image; a timeout still stops the call
    if (signal.aborted) throw error;
    return null;
  }
}

/** The Wikidata ids a search names: an id or link names one item, an IMDb or TMDb id finds the item that holds it */
async function candidates(text: string, signal: AbortSignal): Promise<string[]> {
  const qid = /(?:^|wikidata\.org\/(?:wiki|entity)\/)(Q\d+)\s*$/i.exec(text.trim());
  if (qid) return [qid[1].toUpperCase()];
  const imdb = /\b(tt\d{7,9})\b/.exec(text);
  const tmdb = /themoviedb\.org\/movie\/(\d+)/.exec(text);
  const statement = imdb ? `${WIKIDATA_FILM.imdb}=${imdb[1]}` : tmdb ? `${WIKIDATA_FILM.tmdb}=${tmdb[1]}` : null;
  if (statement) {
    const found = await api({ action: "query", list: "search", srsearch: `haswbstatement:${statement}`, srnamespace: "0", srlimit: "5" }, signal);
    return (((found.query as { search?: { title: string }[] })?.search ?? []).map((hit) => hit.title)).filter((id) => /^Q\d+$/.test(id));
  }
  const found = await api({ action: "wbsearchentities", search: text, language: "en", uselang: "en", type: "item", limit: "20" }, signal);
  return ((found.search ?? []) as { id: string }[]).map((hit) => hit.id).filter((id) => /^Q\d+$/.test(id));
}

/** Cast and crew in credit order: a cast in its billing order when Wikidata numbers every member, else in its own order */
function creditStatements(item: Entity) {
  return FILM_CREDIT_PROPERTIES.flatMap(([property, role]) => {
    const list = statements(item, property, { all: true }).map((claim, index) => ({
      role,
      id: itemId(claim.mainsnak?.datavalue?.value),
      characterIds: qualifierValues(claim, WIKIDATA_FILM.characterRole).map(itemId).filter((id): id is string => !!id),
      characterNames: qualifierValues(claim, WIKIDATA_FILM.characterName).filter((v): v is string => typeof v === "string"),
      ordinal: Number(qualifierValues(claim, WIKIDATA_FILM.ordinal)[0]),
      index,
    }));
    if (list.length && list.every((c) => Number.isInteger(c.ordinal))) list.sort((a, b) => a.ordinal - b.ordinal || a.index - b.index);
    // A person listed twice in one role (two characters) is one credit with both
    const merged = new Map<string, (typeof list)[number]>();
    for (const c of list) {
      const same = c.id ? merged.get(c.id) : undefined;
      if (same) {
        same.characterIds.push(...c.characterIds);
        same.characterNames.push(...c.characterNames);
      } else merged.set(c.id ?? `#${c.index}`, c);
    }
    return [...merged.values()];
  });
}

export const wikidataFilms: ProviderAdapter<"film"> = {
  id: "wikidata",
  label: "Wikidata",
  domain: "film",
  levels: ["work", "version", "release"],
  fields: {
    work: ["title", "originalTitle", "description", "releaseDate", "countries", "languages", "credits", "organizations", "identifiers", "image"],
    version: ["runtimeSeconds"],
    release: ["releaseDate", "place"],
  },
  documentation: "https://www.wikidata.org/wiki/Wikidata:Data_access",
  needsKey: false,
  limits: { timeoutMs: 20000, minIntervalMs: 1000, maxResults: 10 },

  async search({ text }, { signal }) {
    const ids = await candidates(text, signal);
    const items = (await wikidataEntities(ids, "labels|descriptions|claims", userAgent(), signal)).filter(isFilm);
    // The year and the director tell a remake from the film it remakes
    const directors = new Map(
      (await wikidataEntities(items.flatMap((e) => itemIds(e, "P57").slice(0, 3)), "labels", userAgent(), signal)).map((e) => [e.id, label(e)]),
    );
    const order = new Map(ids.map((id, i) => [id, i]));
    return items
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      .map((e) => {
        const year = earliestDate(statements(e, WIKIDATA_FILM.publicationDate, { all: true }).map((c) => c.mainsnak!.datavalue!.value))?.start?.year ?? null;
        const by = itemIds(e, "P57")
          .slice(0, 3)
          .map((id) => directors.get(id))
          .filter(Boolean)
          .join(", ");
        const detail = [year, by && `directed by ${by}`].filter(Boolean).join(" · ") || e.descriptions?.en?.value || null;
        return { externalId: e.id, title: label(e) ?? e.id, detail, url: `https://www.wikidata.org/wiki/${e.id}` };
      });
  },

  async detail(externalId, { signal }) {
    if (!/^Q\d+$/.test(externalId)) throw new ProviderError("A Wikidata id looks like Q193570", "invalid");
    const [item] = await wikidataEntities([externalId], "labels|descriptions|claims", userAgent(), signal);
    if (!item) throw new ProviderError(`Wikidata has no item ${externalId}`, "invalid");
    if (!isFilm(item)) throw new ProviderError(`${label(item) ?? externalId} is not a film on Wikidata`, "invalid");

    const credits = creditStatements(item);
    const published = statements(item, WIKIDATA_FILM.publicationDate, { all: true }).map((claim) => ({
      date: claim.mainsnak!.datavalue!.value,
      placeId: qualifierValues(claim, WIKIDATA_FILM.placeOfPublication).map(itemId).find(Boolean) ?? null,
    }));
    const countryIds = itemIds(item, WIKIDATA_FILM.countryOfOrigin);
    const languageIds = itemIds(item, WIKIDATA_FILM.originalLanguage);
    const companyIds = statements(item, WIKIDATA_FILM.productionCompany, { all: true })
      .map((c) => itemId(c.mainsnak?.datavalue?.value))
      .filter((id): id is string => !!id);
    // Every name in as few calls as the API allows, 50 ids to a call
    const linked = [
      ...countryIds,
      ...languageIds,
      ...companyIds,
      ...published.flatMap((p) => (p.placeId ? [p.placeId] : [])),
      // People before their characters: past the cap, a character goes unnamed, not a person
      ...credits.flatMap((c) => (c.id ? [c.id] : [])),
      ...credits.flatMap((c) => c.characterIds),
    ];
    const [entities, codes] = await Promise.all([
      wikidataEntities(linked, "labels", userAgent(), signal, { max: MAX_LINKED }),
      isoCodes(countryIds, languageIds, published.flatMap((p) => (p.placeId ? [p.placeId] : [])), signal),
    ]);
    const names = new Map(entities.map((e) => [e.id, label(e)]));
    const named = (id: string | null): Named | null => {
      const name = id ? names.get(id) : null;
      return id && name ? { id, label: name } : null;
    };
    const many = (ids: string[]) => ids.map(named).filter((n): n is Named => !!n);

    const titleValue = values(item, WIKIDATA_FILM.title)[0] as { text?: string; language?: string } | undefined;
    const file = (values(item, WIKIDATA_FILM.poster)[0] ?? values(item, WIKIDATA_FILM.image)[0]) as string | undefined;
    const kind = values(item, WIKIDATA_FILM.poster)[0] ? "poster" : "still";
    const text = (property: string) => {
      const value = values(item, property)[0];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    const people = credits.map((c) => ({ ...c, person: named(c.id) }));
    const payload: WikidataFilmPayload = {
      id: item.id,
      label: label(item),
      title: titleValue?.text && titleValue.language ? { text: titleValue.text, language: titleValue.language } : null,
      description: item.descriptions?.en?.value ?? null,
      releases: published.map((p) => {
        const place = named(p.placeId);
        return { date: p.date, place: place && codes.place(place) };
      }),
      countries: many(countryIds).map(codes.place),
      languages: many(languageIds).map(codes.language),
      runtimes: [...new Set(values(item, WIKIDATA_FILM.duration).map(seconds).filter((n): n is number => !!n))],
      credits: people
        .filter((c): c is typeof c & { person: Named } => !!c.person)
        .map((c) => ({
          role: c.role,
          person: c.person,
          characters: [...new Set([...c.characterIds.map((id) => names.get(id)).filter((n): n is string => !!n), ...c.characterNames])],
        })),
      unnamedCredits: people.filter((c) => !c.person).length,
      companies: many([...new Set(companyIds)]),
      identifiers: { imdb: text(WIKIDATA_FILM.imdb), tmdb: text(WIKIDATA_FILM.tmdb), letterboxd: text(WIKIDATA_FILM.letterboxd) },
      image: typeof file === "string" && file.trim() ? await commonsImage(file.trim(), kind, signal) : null,
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
    const p = detail.payload as unknown as WikidataFilmPayload;
    const work: Record<string, unknown> = {};
    if (p.label) work.title = p.label;
    if (p.title?.text && p.title.text !== p.label) work.originalTitle = p.title.text;
    if (p.description) work.description = p.description;
    const released = earliestDate((p.releases ?? []).map((r) => r.date));
    if (released) work.releaseDate = released;
    // Codes only when stated; an answer saved before codes were read has none
    const place = (c: Place) => ({ wikidataId: c.id, name: c.label, ...(c.alpha2 ? { alpha2: c.alpha2 } : {}) });
    if (p.countries?.length) work.countries = p.countries.map(place);
    if (p.languages?.length)
      work.languages = p.languages.map((l) => ({ wikidataId: l.id, name: l.label, ...(l.iso6391 ? { iso6391: l.iso6391 } : {}), ...(l.iso6393 ? { iso6393: l.iso6393 } : {}) }));
    if (p.credits?.length)
      work.credits = p.credits.map((c) => ({ wikidataId: c.person.id, name: c.person.label, roleId: c.role, characters: c.role === "film.cast" ? c.characters : [] }));
    if (p.companies?.length) work.organizations = p.companies.map((o) => ({ wikidataId: o.id, name: o.label, role: "production_company" }));
    const ids = Object.fromEntries(Object.entries(p.identifiers ?? {}).filter(([, v]) => !!v));
    if (Object.keys(ids).length) work.identifiers = ids;
    if (p.image) work.image = p.image;
    const proposals: ReturnType<ProviderAdapter<"film">["normalize"]> = [{ level: "work", fields: work }];
    if (p.runtimes?.length) proposals.push({ level: "version", fields: { runtimeSeconds: p.runtimes[0] } });
    for (const r of p.releases ?? []) {
      const date = wikidataDate(r.date);
      if (date) proposals.push({ level: "release", fields: { releaseDate: date, place: r.place ? place(r.place) : null } });
    }
    return proposals;
  },
};
