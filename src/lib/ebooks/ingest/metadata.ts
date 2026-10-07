import sanitizeHtml from "sanitize-html";
import { defaultSortName, naturalAuthorName, naturalNameParts } from "@/lib/utils/author-names";
import { normalizeLanguage } from "@/lib/utils/language";
import { normalizeSearchText } from "@/lib/utils/search-text";
import { isbn10To13, validIsbn10, validIsbn13 } from "@/lib/match/plan";
import type { FileMetadata } from "./inspect/types";

/*
 * One e-book's fields from its files (SLN-494). Each field comes from the
 * first source that has it, in this order: the sidecar OPF (the cleaned
 * record a manager exported), the EPUB's OPF, AZW3, MOBI, FB2, PDF, CBZ,
 * then the file name. ISBNs and other identifiers are gathered from all of
 * them; an ISBN that does not validate is kept aside for the report.
 */

export const METADATA_PRECEDENCE = ["sidecar", "epub", "azw3", "mobi", "fb2", "pdf", "cbz", "filename"] as const;
export type MetadataSource = (typeof METADATA_PRECEDENCE)[number];

export interface MetadataInput {
  source: MetadataSource;
  metadata: FileMetadata;
}

export interface MergedMetadata {
  title: string;
  titleSort: string;
  subtitle: string | null;
  /** In natural order */
  authors: string[];
  authorSort: string | null;
  language: string | null;
  /** Valid ISBN-13s, canonical */
  isbns: string[];
  /** Other identifiers by scheme; `isbn_invalid` holds ISBNs that did not validate */
  identifiers: Record<string, string[]>;
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  publishedYear: number | null;
  description: string | null;
  subjects: string[];
  searchText: string;
}

const DESCRIPTION_LIMIT = 20_000;
/** Roles that make a creator an author; a creator with no role is one too */
const AUTHOR_ROLES = new Set(["aut", "author", "writer", "creator"]);
const LEADING_ARTICLES = /^(the|a|an|le|la|les|l'|el|los|las|un|una|der|die|das|ein|eine|il|lo|gli|i|o|os|as|de|het|een)\s+/i;
/** The identifier schemes kept under their own name; any other keeps its own */
const SCHEME_NAMES: Record<string, string> = {
  "mobi-asin": "asin",
  amazon: "asin",
  "amazon_uk": "asin",
  isbn13: "isbn",
  isbn10: "isbn",
  "google-books": "google",
  gbooks: "google",
  "open-library": "openlibrary",
  olid: "openlibrary",
  worldcat: "oclc",
};

const clean = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
};

/** The base name of a file, as a title of last resort: "Nadja", "The_Third_Policeman" becomes "The Third Policeman" */
export function titleFromFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/(\.kepub)?\.[^.]+$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || base;
}

/** The title for sorting: no leading article, accents and case folded, numbers in order */
export function titleSortKey(title: string): string {
  const folded = normalizeSearchText(title.replace(LEADING_ARTICLES, ""));
  return (folded || normalizeSearchText(title)).replace(/\d+/g, (n) => n.padStart(10, "0"));
}

/** A year from a written date; the year-101 placeholder library managers write and impossible years are null */
export function publishedYearOf(date: string | null | undefined): number | null {
  const match = date?.match(/(^|\D)(\d{4})(\D|$)/) ?? date?.match(/^(\d{1,4})/);
  const year = match ? Number(match[2] ?? match[1]) : NaN;
  if (!Number.isInteger(year) || year === 101 || year < 1 || year > new Date().getUTCFullYear() + 1) return null;
  return year;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** A description as plain paragraphs: no markup, no script, at most 20,000 characters */
export function cleanDescription(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const allowed = sanitizeHtml(raw, { allowedTags: ["p", "br", "div", "li"], allowedAttributes: {}, nonTextTags: ["script", "style", "textarea", "noscript", "title"] });
  const text = allowed
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => ENTITIES[name])
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  if (!text) return null;
  return text.length > DESCRIPTION_LIMIT ? text.slice(0, DESCRIPTION_LIMIT).trimEnd() : text;
}

/** Valid ISBNs as ISBN-13s, and the ones that did not validate */
export function canonicalIsbns(values: string[]): { isbns: string[]; invalid: string[] } {
  const isbns = new Set<string>();
  const invalid = new Set<string>();
  for (const value of values) {
    const raw = value.replace(/^urn:isbn:/i, "").trim();
    if (!raw) continue;
    const thirteen = validIsbn13(raw);
    const ten = thirteen ? null : validIsbn10(raw);
    if (thirteen) isbns.add(thirteen);
    else if (ten) isbns.add(isbn10To13(ten));
    else invalid.add(raw);
  }
  return { isbns: [...isbns], invalid: [...invalid] };
}

/** One e-book's fields from what its files say */
export function mergeMetadata(inputs: MetadataInput[], fileName: string): MergedMetadata {
  const ordered = [...inputs, { source: "filename" as const, metadata: { title: titleFromFileName(fileName) } }].sort(
    (a, b) => METADATA_PRECEDENCE.indexOf(a.source) - METADATA_PRECEDENCE.indexOf(b.source),
  );
  const pick = <T>(read: (m: FileMetadata) => T | null | undefined, present: (v: T) => boolean = Boolean as (v: T) => boolean) => {
    for (const { metadata } of ordered) {
      const value = read(metadata);
      if (value !== null && value !== undefined && present(value)) return value;
    }
    return null;
  };

  const title = pick((m) => clean(m.title)) ?? titleFromFileName(fileName);
  const creators = pick(
    (m) => (m.authors ?? []).filter((a) => clean(a.name) && (!a.role || AUTHOR_ROLES.has(a.role.toLowerCase()))),
    (list) => list.length > 0,
  );
  const authors = [...new Set((creators ?? []).map((a) => naturalAuthorName(clean(a.name)!)))];
  const firstCreator = creators?.[0];
  const authorSort = firstCreator
    ? clean(firstCreator.fileAs) ?? naturalNameParts(clean(firstCreator.name)!)?.sortName ?? defaultSortName(authors[0])
    : null;

  const identifiers: Record<string, string[]> = {};
  const isbnValues: string[] = [];
  for (const { metadata } of ordered) {
    for (const { scheme, value } of metadata.identifiers ?? []) {
      const name = SCHEME_NAMES[scheme.toLowerCase()] ?? scheme.toLowerCase();
      const v = value.trim();
      if (!v) continue;
      if (name === "isbn") isbnValues.push(v);
      else if (!(identifiers[name] ??= []).includes(v)) identifiers[name].push(v);
    }
  }
  const { isbns, invalid } = canonicalIsbns(isbnValues);
  if (invalid.length) identifiers.isbn_invalid = invalid;

  const subtitle = pick((m) => clean(m.subtitle));
  const series = pick((m) => clean(m.series));
  const seriesIndex = series ? pick((m) => (clean(m.series) === series ? m.seriesIndex : null), (n) => Number.isFinite(n)) : null;
  const subjects = pick((m) => (m.subjects ?? []).map(clean).filter((s): s is string => !!s), (list) => list.length > 0) ?? [];

  return {
    title,
    titleSort: titleSortKey(title),
    subtitle,
    authors,
    authorSort,
    language: pick((m) => normalizeLanguage(m.language)),
    isbns,
    identifiers,
    series,
    seriesIndex,
    publisher: pick((m) => clean(m.publisher)),
    publishedYear: pick((m) => publishedYearOf(m.date)),
    description: pick((m) => cleanDescription(m.description)),
    subjects: [...new Set(subjects)],
    searchText: normalizeSearchText([title, subtitle, ...authors, series].filter(Boolean).join(" ")),
  };
}
