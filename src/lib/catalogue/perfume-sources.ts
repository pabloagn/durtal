import type { PerfumeConcentration } from "./perfume-labels";

/*
 * Where perfume facts can come from (SLN-377), and what Durtal may do with
 * each. Only a source with a documented public API is looked up; every other
 * one is cited by hand, and Durtal never reads its pages. A perfume is
 * complete without any of them.
 */

export interface PerfumeSource {
  name: string;
  hosts: readonly string[];
  /** lookup: Durtal asks its API; cite: the person reads it and enters what it says */
  access: "lookup" | "cite";
  /** Why it is used this way */
  why: string;
  /** What it has, said plainly */
  covers: string;
}

export const PERFUME_SOURCES: readonly PerfumeSource[] = [
  {
    name: "Wikidata",
    hosts: ["wikidata.org", "m.wikidata.org"],
    access: "lookup",
    why: "A documented public API; its data is CC0",
    covers:
      "Name, brand, manufacturer, perfumers and launch date of well-known perfumes. No notes, no concentrations, and few recent or niche releases",
  },
  {
    name: "Fragrantica",
    hosts: ["fragrantica.com", "fragrantica.fr", "fragrantica.de", "fragrantica.es", "fragrantica.it", "fragrantica.ru"],
    access: "cite",
    why: "No public API. Durtal does not read its pages",
    covers: "Notes, perfumers, launch years and concentrations, as its editors and members report them",
  },
  {
    name: "Basenotes",
    hosts: ["basenotes.com", "basenotes.net"],
    access: "cite",
    why: "No public API. Durtal does not read its pages",
    covers: "Notes, perfumers and launch years, with members' reviews",
  },
  {
    name: "Parfumo",
    hosts: ["parfumo.com", "parfumo.de", "parfumo.net"],
    access: "cite",
    why: "No public API. Durtal does not read its pages",
    covers: "Notes, perfumers, launch years and batch codes, as its members report them",
  },
];

export interface PerfumeLinkReading {
  url: string;
  host: string;
  source: PerfumeSource | null;
  /** The source's own id in the address, when it has one */
  externalId: string | null;
  /** What the address itself says; never read from the page */
  hints: { title: string | null; house: string | null; concentration: PerfumeConcentration | null };
}

const CONCENTRATION_WORDS: [RegExp, PerfumeConcentration][] = [
  [/\b(extrait de parfum|extrait)$/i, "extrait"],
  [/\b(eau de parfum|edp)$/i, "eau_de_parfum"],
  [/\b(eau de toilette|edt)$/i, "eau_de_toilette"],
  [/\b(eau de cologne|edc|cologne)$/i, "eau_de_cologne"],
  [/\b(eau fra[iî]che)$/i, "eau_fraiche"],
  [/\b(perfume oil|parfum oil|oil)$/i, "oil"],
  [/\b(pure parfum|parfum)$/i, "parfum"],
];

/** A name and the concentration its last words name: "Shalimar Eau de Parfum" is Shalimar, eau de parfum */
export function splitConcentration(name: string): { title: string; concentration: PerfumeConcentration | null } {
  const clean = name.replace(/\s+/g, " ").trim();
  for (const [words, concentration] of CONCENTRATION_WORDS) {
    const match = words.exec(clean);
    if (match && match.index > 0) return { title: clean.slice(0, match.index).trim(), concentration };
  }
  return { title: clean, concentration: null };
}

/** A path part as text; a stray "%" (not an escape) is kept as it is */
function decoded(part: string) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
const words = (slug: string) =>
  decoded(slug)
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const capitalized = (text: string) => text.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());

/** What a link to a perfume source says by its address alone; null when it is not a web link */
export function readPerfumeLink(input: string): PerfumeLinkReading | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const source = PERFUME_SOURCES.find((s) => s.hosts.includes(host)) ?? null;
  const parts = url.pathname.split("/").filter(Boolean);
  let externalId: string | null = null;
  let title: string | null = null;
  let house: string | null = null;

  if (source?.name === "Wikidata") {
    const id = parts.find((p) => /^Q\d+$/.test(p));
    externalId = id ?? null;
  } else if (source?.name === "Fragrantica" && parts[0]?.toLowerCase() === "perfume" && parts.length >= 3) {
    // /perfume/Chanel/Chanel-No-5-Parfum-28711.html
    house = words(parts[1]);
    const match = /^(.*?)-(\d+)\.html$/i.exec(parts[2]);
    if (match) {
      title = words(match[1]);
      externalId = match[2];
    }
  } else if (source?.name === "Basenotes" && parts[0]?.toLowerCase() === "fragrances" && parts[1]) {
    // /fragrances/no-5-parfum-by-chanel.26129046
    const match = /^(.*)-by-(.*?)(?:\.(\d+))?$/i.exec(parts[1]);
    if (match) {
      title = capitalized(words(match[1]));
      house = capitalized(words(match[2]));
      externalId = match[3] ?? null;
    }
  } else if (source?.name === "Parfumo" && parts[0]?.toLowerCase() === "perfumes" && parts.length >= 3) {
    // /Perfumes/Chanel/no-5-parfum
    house = words(parts[1]);
    title = capitalized(words(parts[2]));
  }
  const split = title ? splitConcentration(title) : null;
  return {
    url: url.toString(),
    host,
    source,
    externalId,
    hints: { title: split?.title || null, house: house || null, concentration: split?.concentration ?? null },
  };
}

/** The source a host belongs to, for a link that is already cited */
export function perfumeSourceFor(host: string) {
  return PERFUME_SOURCES.find((s) => s.hosts.includes(host.toLowerCase().replace(/^www\./, ""))) ?? null;
}
