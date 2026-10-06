import { ExternalFetchError, fetchOk } from "@/lib/api/external-fetch";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import { ProviderError, type ProviderAdapter, type ProviderDetail, type ProviderProposal } from "./contract";

/*
 * Museum collections as painting providers (SLN-378). Each one has a
 * documented open API that needs no key. A museum says what the work is, who
 * it attributes it to, its accession number, size and image, and whether it
 * is on view in its own galleries. It does not say where an object is when it
 * is not on view, and owning an object never means showing it: a location is
 * proposed only from a museum's own dated "on view" answer.
 */

/** One museum's answer, in one shape for every museum */
export interface MuseumArtwork {
  [key: string]: unknown;
  institution: { name: string; wikidataId: string };
  id: string;
  title: string | null;
  /** The attribution as the museum writes it: "Rembrandt van Rijn (Dutch, 1606–1669)" */
  attribution: string | null;
  /** The artist's name alone, when the museum gives it */
  artist: string | null;
  date: { display: string | null; start: number | null; end: number | null };
  medium: string | null;
  /** Centimetres; the museum's own text beside them */
  dimensions: { text: string | null; heightCm: number | null; widthCm: number | null; depthCm: number | null };
  accessionNumber: string | null;
  creditLine: string | null;
  /** true: on view in its galleries; false: not on view; null: the museum does not say */
  onView: boolean | null;
  gallery: string | null;
  image: { url: string; credit: string; license: string | null } | null;
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const year = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value !== 0 ? value : null);

/** A museum's begin and end years as a catalogue date: one year, or a range */
export function museumDate(start: number | null, end: number | null): CatalogueDateInput | null {
  if (start === null) return null;
  if (end === null || end === start) return { precision: "year", start: { year: start } };
  if (end < start) return null;
  return { precision: "range", start: { year: start }, end: { year: end } };
}

/** The proposals of a museum answer: the work, and the object the museum holds */
export function museumProposals(detail: ProviderDetail): ProviderProposal<"work" | "art_object">[] {
  const a = detail.payload as unknown as MuseumArtwork;
  const work: Record<string, unknown> = {};
  if (a.title) work.title = a.title;
  const created = museumDate(a.date?.start ?? null, a.date?.end ?? null);
  if (created) work.creationDate = created;
  if (a.attribution || a.artist) work.painter = { name: a.artist ?? a.attribution, attribution: a.attribution };
  const object: Record<string, unknown> = {
    owner: { name: a.institution.name, wikidataId: a.institution.wikidataId, providerId: a.id },
  };
  if (a.accessionNumber) object.accessionNumber = a.accessionNumber;
  const { heightCm, widthCm, depthCm } = a.dimensions ?? {};
  if (heightCm || widthCm) object.dimensions = { height: heightCm, width: widthCm, depth: depthCm ?? null, unit: "cm" };
  object.display = { onView: a.onView, gallery: a.gallery };
  if (a.image) object.image = a.image;
  return [
    { level: "work", fields: work },
    { level: "art_object", fields: object },
  ];
}

const FIELDS = {
  work: ["title", "creationDate", "painter"],
  art_object: ["owner", "accessionNumber", "dimensions", "display", "image"],
} as const;

// ── Art Institute of Chicago ─────────────────────────────────────────────────

const ARTIC = "https://api.artic.edu/api/v1/artworks";
const ARTIC_HEADERS = { "AIC-User-Agent": "Durtal personal catalogue", Accept: "application/json" };
const ARTIC_FIELDS = [
  "id",
  "title",
  "artist_display",
  "artist_title",
  "date_display",
  "date_start",
  "date_end",
  "medium_display",
  "dimensions",
  "dimensions_detail",
  "main_reference_number",
  "credit_line",
  "is_on_view",
  "gallery_title",
  "image_id",
  "is_public_domain",
].join(",");

/** The Art Institute's answer in the common shape */
export function articArtwork(data: Record<string, unknown>, iiif: string | null): MuseumArtwork {
  const detail = (Array.isArray(data.dimensions_detail) ? data.dimensions_detail : []) as Record<string, unknown>[];
  const overall = detail.find((d) => !text(d.clarification)) ?? detail[0] ?? {};
  const imageId = text(data.image_id);
  return {
    institution: { name: "Art Institute of Chicago", wikidataId: "Q239303" },
    id: String(data.id),
    title: text(data.title),
    attribution: text(data.artist_display),
    artist: text(data.artist_title),
    date: { display: text(data.date_display), start: year(data.date_start), end: year(data.date_end) },
    medium: text(data.medium_display),
    dimensions: { text: text(data.dimensions), heightCm: number(overall.height), widthCm: number(overall.width), depthCm: number(overall.depth) },
    accessionNumber: text(data.main_reference_number),
    creditLine: text(data.credit_line),
    onView: typeof data.is_on_view === "boolean" ? data.is_on_view : null,
    gallery: text(data.gallery_title),
    image:
      imageId && iiif && data.is_public_domain === true
        ? { url: `${iiif}/${imageId}/full/843,/0/default.jpg`, credit: "Art Institute of Chicago", license: "CC0 1.0" }
        : null,
  };
}

export const articArtworks: ProviderAdapter<"painting"> = {
  id: "artic",
  label: "Art Institute of Chicago",
  domain: "painting",
  levels: ["work", "art_object"],
  fields: FIELDS,
  documentation: "https://api.artic.edu/docs/",
  needsKey: false,
  // Anonymous use: 60 requests a minute
  limits: { timeoutMs: 12000, minIntervalMs: 1000, maxResults: 10 },

  async search({ text: query }, { signal }) {
    const url = `${ARTIC}/search?${new URLSearchParams({ q: query, limit: "10", fields: "id,title,artist_display,date_display" })}`;
    const body = (await (await fetchOk(url, { headers: ARTIC_HEADERS, signal })).json()) as { data?: Record<string, unknown>[] };
    return (body.data ?? []).map((row) => ({
      externalId: String(row.id),
      title: text(row.title) ?? String(row.id),
      detail: [text(row.artist_display)?.split("\n")[0], text(row.date_display)].filter(Boolean).join(", ") || null,
      url: `https://www.artic.edu/artworks/${row.id}`,
    }));
  },

  async detail(externalId, { signal }) {
    if (!/^\d+$/.test(externalId)) throw new ProviderError("An Art Institute id is a number", "invalid");
    const res = await fetchOk(`${ARTIC}/${externalId}?fields=${ARTIC_FIELDS}`, { headers: ARTIC_HEADERS, signal });
    const body = (await res.json()) as { data?: Record<string, unknown>; config?: { iiif_url?: string } };
    if (!body.data) throw new ProviderError(`The Art Institute has no artwork ${externalId}`, "invalid");
    const artwork = articArtwork(body.data, body.config?.iiif_url ?? null);
    return {
      externalId: artwork.id,
      url: `https://www.artic.edu/artworks/${artwork.id}`,
      attribution: "Art Institute of Chicago",
      license: "CC0 1.0",
      payload: artwork as unknown as ProviderDetail["payload"],
    };
  },

  normalize: museumProposals,
};

// ── The Metropolitan Museum of Art ───────────────────────────────────────────

const MET = "https://collectionapi.metmuseum.org/public/collection/v1";
const MET_SEARCH = "https://collectionapi.metmuseum.org/public/collection/v1.1/search";

/** The Met's answer in the common shape */
export function metArtwork(data: Record<string, unknown>): MuseumArtwork {
  const measurements = (Array.isArray(data.measurements) ? data.measurements : []) as Record<string, unknown>[];
  const overall = measurements.find((m) => /overall/i.test(String(m.elementName ?? ""))) ?? measurements[0];
  const size = (overall?.elementMeasurements ?? {}) as Record<string, unknown>;
  const gallery = text(data.GalleryNumber);
  const image = text(data.primaryImage);
  return {
    institution: { name: "The Metropolitan Museum of Art", wikidataId: "Q160236" },
    id: String(data.objectID),
    title: text(data.title),
    attribution: [text(data.artistPrefix), text(data.artistDisplayName)].filter(Boolean).join(" ") || null,
    artist: text(data.artistDisplayName),
    date: { display: text(data.objectDate), start: year(data.objectBeginDate), end: year(data.objectEndDate) },
    medium: text(data.medium),
    dimensions: { text: text(data.dimensions), heightCm: number(size.Height), widthCm: number(size.Width), depthCm: number(size.Depth) },
    accessionNumber: text(data.accessionNumber),
    creditLine: text(data.creditLine),
    // An empty gallery number: the Met does not show it now, and says no more
    onView: gallery ? true : false,
    gallery: gallery ? `Gallery ${gallery}` : null,
    image: image && data.isPublicDomain === true ? { url: image, credit: "The Metropolitan Museum of Art", license: "CC0 1.0" } : null,
  };
}

export const metArtworks: ProviderAdapter<"painting"> = {
  id: "metmuseum",
  label: "The Met",
  domain: "painting",
  levels: ["work", "art_object"],
  fields: FIELDS,
  documentation: "https://metmuseum.github.io/",
  needsKey: false,
  limits: { timeoutMs: 15000, minIntervalMs: 1000, maxResults: 10 },

  async search({ text: query }, { signal }) {
    // v1/search was retired on 2026-10-01; v1.1 pages its answer
    const url = `${MET_SEARCH}?${new URLSearchParams({ q: query, offset: "0", limit: "8" })}`;
    const body = (await (await fetchOk(url, { signal })).json()) as { objectIDs?: unknown };
    const ids = (Array.isArray(body.objectIDs) ? body.objectIDs : []).filter((id): id is number => Number.isInteger(id)).slice(0, 8);
    // The search answers ids only: each one is read, all at once (the Met allows 80 requests a second)
    const objects = await Promise.all(
      ids.map(async (id) => {
        try {
          return (await (await fetchOk(`${MET}/objects/${id}`, { signal })).json()) as Record<string, unknown>;
        } catch (error) {
          // The search can list an object the Met no longer shows: skip it, keep the others
          if (error instanceof ExternalFetchError && error.status === 404) return null;
          throw error;
        }
      }),
    );
    return objects
      .filter((object): object is Record<string, unknown> => !!object)
      .map((object) => {
        const artwork = metArtwork(object);
        return {
          externalId: artwork.id,
          title: artwork.title ?? artwork.id,
          detail: [artwork.artist, artwork.date.display, text(object.classification)].filter(Boolean).join(", ") || null,
          url: text(object.objectURL),
        };
      });
  },

  async detail(externalId, { signal }) {
    if (!/^\d+$/.test(externalId)) throw new ProviderError("A Met object id is a number", "invalid");
    const object = (await (await fetchOk(`${MET}/objects/${externalId}`, { signal })).json()) as Record<string, unknown>;
    if (!object.objectID) throw new ProviderError(`The Met has no object ${externalId}`, "invalid");
    const artwork = metArtwork(object);
    return {
      externalId: artwork.id,
      url: text(object.objectURL) ?? `https://www.metmuseum.org/art/collection/search/${artwork.id}`,
      attribution: "The Metropolitan Museum of Art",
      license: object.isPublicDomain === true ? "CC0 1.0" : null,
      payload: artwork as unknown as ProviderDetail["payload"],
    };
  },

  normalize: museumProposals,
};
