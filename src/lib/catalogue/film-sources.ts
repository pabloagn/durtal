import { catalogueDateSchema, catalogueDateText, type CatalogueDateInput } from "./dates";
import { formatRuntime } from "./film-labels";
import type { FILM_RELEASE_FORMATS } from "./films";

/*
 * Where film facts can come from (SLN-376), and what Durtal may do with each.
 * Only a source with a documented public API that needs no key is looked up;
 * every other one is cited by hand, and Durtal never reads its pages. A film
 * is complete without any of them.
 */

export interface FilmSource {
  name: string;
  hosts: readonly string[];
  /** lookup: Durtal asks its API; cite: the person reads it and enters what it says */
  access: "lookup" | "cite";
  /** Why it is used this way: its terms, its key, its attribution */
  why: string;
  /** What it has, said plainly */
  covers: string;
}

export const FILM_SOURCES: readonly FilmSource[] = [
  {
    name: "Wikidata",
    hosts: ["wikidata.org", "m.wikidata.org"],
    access: "lookup",
    why: "A documented public API with no key and no account; its data is CC0, so it needs no credit. Images come from Wikimedia Commons under each file's own license, credited as Commons states it",
    covers:
      "Titles, the first release and release dates per country or festival, countries, original languages, running time, directors, writers, cast and crew, production companies, and the film's IMDb, TMDB and Letterboxd ids. Cast lists are often partial, and recent, short or obscure films may be missing",
  },
  {
    name: "TMDB",
    hosts: ["themoviedb.org"],
    access: "cite",
    why: "An official API, but it needs an API key from an account, is free for non-commercial use only, and asks every app to show its logo with \"This product uses the TMDB API but is not endorsed or certified by TMDB\". Not connected: Durtal has no key",
    covers: "Full billed casts with characters, crew by department, release dates per country with their type, running times and posters",
  },
  {
    name: "IMDb",
    hosts: ["imdb.com", "m.imdb.com"],
    access: "cite",
    why: "No public API: its data is licensed through a paid service, and its datasets are for personal, non-commercial use under their own terms. Durtal does not read its pages",
    covers: "Full casts and crews, release dates, alternate versions and running times",
  },
  {
    name: "Letterboxd",
    hosts: ["letterboxd.com", "boxd.it"],
    access: "cite",
    why: "Its API is open only to approved applications. Durtal does not read its pages",
    covers: "Casts, crews, releases and members' reviews and lists",
  },
];

/**
 * How a release reached the public, as far as Wikidata's place says: a film
 * festival by its name, otherwise a theatrical release in that country or,
 * with no place, "other". Wikidata never says the format; the person can
 * change it after saving.
 */
export function releaseFormat(place: string | null): (typeof FILM_RELEASE_FORMATS)[number] {
  if (!place) return "other";
  return /\bfestival\b|\bbiennale\b|\bmostra\b|\bberlinale\b/i.test(place) ? "festival" : "theatrical";
}

/** A poster or still on Wikimedia Commons, with the terms Commons gives */
export interface FilmImage {
  /** The Commons file name */
  file: string;
  kind: "poster" | "still";
  /** The original file, for the media pipeline to download */
  url: string;
  /** The file's page on Commons, with its full terms */
  page: string;
  /** The author as Commons states it */
  credit: string | null;
  license: string | null;
  licenseUrl: string | null;
}

type Named = { wikidataId: string; name: string };
/** A country or a release's place; `alpha2` (ISO 3166-1) when Wikidata states it */
export type FilmPlace = Named & { alpha2?: string };
/** A language; its ISO 639-1 and 639-3 codes when Wikidata states them */
export type FilmLanguage = Named & { iso6391?: string; iso6393?: string };
/** What one film answer proposes, by level */
export interface FilmProposals {
  work: {
    title?: string;
    originalTitle?: string;
    description?: string;
    releaseDate?: CatalogueDateInput;
    countries?: FilmPlace[];
    languages?: FilmLanguage[];
    credits?: (Named & { roleId: string; characters: string[] })[];
    organizations?: (Named & { role: "production_company" })[];
    identifiers?: Partial<Record<"imdb" | "tmdb" | "letterboxd", string>>;
    image?: FilmImage;
  };
  runtimeSeconds: number | null;
  releases: { releaseDate: CatalogueDateInput; place: FilmPlace | null }[];
}

const names = (list: Named[] | undefined) => (list ?? []).map((n) => n.name);
/** A proposed date as the catalogue writes it: "1972", "Mar 20, 1972" */
const dateText = (date: CatalogueDateInput | undefined) => (date ? catalogueDateText(catalogueDateSchema.parse(date)) : null);
const listed = (list: string[]) => (list.length > 3 ? `${list.slice(0, 3).join(", ")} and ${list.length - 3} more` : list.join(", "));

/**
 * What changed between two answers of the source for one film, said plainly:
 * the film here keeps its values, and a change is for the person to weigh.
 */
export function filmSourceChanges(before: FilmProposals, after: FilmProposals): string[] {
  const lines: string[] = [];
  const text = (label: string, a: string | null | undefined, b: string | null | undefined) => {
    if ((a ?? null) !== (b ?? null)) lines.push(`${label}: ${a || "none"} → ${b || "none"}`);
  };
  text("Title", before.work.title, after.work.title);
  text("Original title", before.work.originalTitle, after.work.originalTitle);
  if ((before.work.description ?? null) !== (after.work.description ?? null)) lines.push("Description: changed");
  text("First release", dateText(before.work.releaseDate), dateText(after.work.releaseDate));
  text("Running time", formatRuntime(before.runtimeSeconds), formatRuntime(after.runtimeSeconds));
  text("Countries", names(before.work.countries).join(", "), names(after.work.countries).join(", "));
  text("Original languages", names(before.work.languages).join(", "), names(after.work.languages).join(", "));
  // Cast and crew: who Wikidata now names, and who it no longer names
  const key = (c: { roleId: string; wikidataId: string }) => `${c.roleId}:${c.wikidataId}`;
  const was = new Map((before.work.credits ?? []).map((c) => [key(c), c.name]));
  const now = new Map((after.work.credits ?? []).map((c) => [key(c), c.name]));
  const adds = [...now].filter(([k]) => !was.has(k)).map(([, n]) => n);
  const drops = [...was].filter(([k]) => !now.has(k)).map(([, n]) => n);
  if (adds.length) lines.push(`Cast and crew: now names ${listed(adds)}`);
  if (drops.length) lines.push(`Cast and crew: no longer names ${listed(drops)}`);
  const release = (r: FilmProposals["releases"][number]) => `${dateText(r.releaseDate)}${r.place ? `, ${r.place.name}` : ""}`;
  const r0 = new Set(before.releases.map(release));
  const r1 = new Set(after.releases.map(release));
  const newReleases = [...r1].filter((r) => !r0.has(r));
  const gone = [...r0].filter((r) => !r1.has(r));
  if (newReleases.length) lines.push(`Releases: now has ${listed(newReleases)}`);
  if (gone.length) lines.push(`Releases: no longer has ${listed(gone)}`);
  return lines;
}
