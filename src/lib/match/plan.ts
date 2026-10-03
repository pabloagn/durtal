/**
 * Match with a preview (task 0184): a source's record is compared with the
 * edition field by field, and nothing is saved until the reader ticks it.
 * Pure module, usable on server and client.
 *
 * Guardrails for what the source sends:
 * - An empty value never clears a field.
 * - Same ISBN: only empty fields are ticked. The reader's values stay.
 * - New ISBN: every field is ticked, because the old values describe another
 *   edition. The imprint and country of the old ISBN are offered for clearing.
 * - A publisher name that looks like a distributor, platform or placeholder
 *   is never ticked.
 * - An ISBN that another edition holds cannot be saved, and nothing is ticked.
 */
import {
  publisherNameProblem,
  sameBookTitle,
} from "@/lib/publishers/names";

export const MATCH_FIELDS = [
  "cover",
  "title",
  "subtitle",
  "publisher",
  "imprint",
  "isbn13",
  "isbn10",
  "publicationYear",
  "pageCount",
  "language",
  "binding",
  "publicationCountry",
  "description",
] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];
export type MatchValue = string | number | null;

export const MATCH_FIELD_LABEL: Record<MatchField, string> = {
  cover: "Cover",
  title: "Title",
  subtitle: "Subtitle",
  publisher: "Publisher",
  imprint: "Imprint",
  isbn13: "ISBN-13",
  isbn10: "ISBN-10",
  publicationYear: "Year",
  pageCount: "Pages",
  language: "Language",
  binding: "Binding",
  publicationCountry: "Country",
  description: "Description",
};

/** Fields a source sends. Values are clean: see src/lib/match/source.ts */
export interface MatchCandidate {
  title: string | null;
  subtitle: string | null;
  publisher: string | null;
  isbn13: string | null;
  isbn10: string | null;
  publicationYear: number | null;
  pageCount: number | null;
  /** Stored language code */
  language: string | null;
  /** One of BINDING_TYPES */
  binding: string | null;
  description: string | null;
  coverUrl: string | null;
}

export interface MatchCurrent
  extends Omit<MatchCandidate, "coverUrl" | "language"> {
  language: string;
  imprint: string | null;
  publicationCountry: string | null;
  /** The source URL of the stored cover */
  coverSourceUrl: string | null;
  hasCover: boolean;
}

export interface MatchContext {
  workTitle: string;
  authors: string[];
  /** Titles of other editions that hold the candidate's ISBNs */
  isbnOwners: Partial<Record<"isbn13" | "isbn10", string>>;
}

export interface MatchRow {
  field: MatchField;
  /** The cover row carries URLs; the reader sees images */
  current: MatchValue;
  /** Null clears the field (imprint and country of an old ISBN only) */
  next: MatchValue;
  /** Ticked by default */
  checked: boolean;
  note: string | null;
  /** Why the value cannot be saved */
  blocked: string | null;
}

export interface MatchPlan {
  rows: MatchRow[];
  /** The source describes another edition: its ISBN is new to this one */
  newEdition: boolean;
  /** Fields where the source agrees with the edition */
  same: number;
  warnings: string[];
}

// ── ISBNs ───────────────────────────────────────────────────────────────────

/** Digits of a valid ISBN-13 (978 or 979), else null */
export function validIsbn13(raw: string | null | undefined): string | null {
  const d = raw?.replace(/[^0-9]/g, "") ?? "";
  if (!/^97[89][0-9]{10}$/.test(d)) return null;
  const sum = [...d.slice(0, 12)].reduce(
    (s, c, i) => s + Number(c) * (i % 2 ? 3 : 1),
    0,
  );
  return (10 - (sum % 10)) % 10 === Number(d[12]) ? d : null;
}

/** Digits of a valid ISBN-10 (last one may be X), else null */
export function validIsbn10(raw: string | null | undefined): string | null {
  const d = raw?.replace(/[^0-9Xx]/g, "").toUpperCase() ?? "";
  if (!/^[0-9]{9}[0-9X]$/.test(d)) return null;
  const sum = [...d].reduce(
    (s, c, i) => s + (c === "X" ? 10 : Number(c)) * (10 - i),
    0,
  );
  return sum % 11 === 0 ? d : null;
}

/** The ISBN-13 of a valid ISBN-10 */
export function isbn10To13(isbn10: string): string {
  const body = "978" + isbn10.slice(0, 9);
  const sum = [...body].reduce(
    (s, c, i) => s + Number(c) * (i % 2 ? 3 : 1),
    0,
  );
  return body + ((10 - (sum % 10)) % 10);
}

/** The ISBN-10 of a valid 978 ISBN-13, else null */
export function isbn13To10(isbn13: string): string | null {
  if (!isbn13.startsWith("978")) return null;
  const body = isbn13.slice(3, 12);
  const sum = [...body].reduce((s, c, i) => s + Number(c) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? "X" : String(check));
}

/** One ISBN-13 for the edition, from either column */
function editionIsbn(isbn13: string | null, isbn10: string | null) {
  const thirteen = validIsbn13(isbn13);
  if (thirteen) return thirteen;
  const ten = validIsbn10(isbn10);
  return ten ? isbn10To13(ten) : null;
}

// ── Comparison ──────────────────────────────────────────────────────────────

/** Text without markup, with single spaces */
export function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether two values of a field say the same thing */
export function sameMatchValue(
  field: MatchField,
  a: MatchValue,
  b: MatchValue,
) {
  if (a === null || b === null) return a === b;
  if (field === "isbn13" || field === "isbn10")
    return String(a).replace(/[^0-9X]/gi, "") ===
      String(b).replace(/[^0-9X]/gi, "");
  return plainText(String(a)).toLowerCase() ===
    plainText(String(b)).toLowerCase();
}

const empty = (v: MatchValue) => v === null || String(v).trim() === "";

// ── The plan ────────────────────────────────────────────────────────────────

const FROM_SOURCE: Exclude<MatchField, "imprint" | "publicationCountry">[] = [
  "cover",
  "title",
  "subtitle",
  "publisher",
  "isbn13",
  "isbn10",
  "publicationYear",
  "pageCount",
  "language",
  "binding",
  "description",
];

export function planMatch(
  current: MatchCurrent,
  candidate: MatchCandidate,
  context: MatchContext,
): MatchPlan {
  const had = editionIsbn(current.isbn13, current.isbn10);
  const gets = editionIsbn(candidate.isbn13, candidate.isbn10);
  const newEdition = !!gets && gets !== had;
  const taken = (["isbn13", "isbn10"] as const).filter(
    (f) =>
      context.isbnOwners[f] && !sameMatchValue(f, current[f], candidate[f]),
  );
  const warnings: string[] = [];
  if (taken.length)
    warnings.push(
      `Another edition already has this ISBN: “${context.isbnOwners[taken[0]]}”. Nothing is ticked.`,
    );
  if (candidate.title && !sameBookTitle(candidate.title, context.workTitle))
    warnings.push(
      `The source’s title “${candidate.title}” does not look like “${context.workTitle}”. Check that it is the same book.`,
    );

  const rows: MatchRow[] = [];
  let same = 0;
  for (const field of FROM_SOURCE) {
    const next = field === "cover" ? candidate.coverUrl : candidate[field];
    const now: MatchValue =
      field === "cover"
        ? current.hasCover
          ? (current.coverSourceUrl ?? "stored")
          : null
        : current[field];
    if (empty(next)) continue;
    if (!empty(now) && sameMatchValue(field, now, next)) {
      same++;
      continue;
    }
    let checked = empty(now) || newEdition;
    let note: string | null = null;
    let blocked: string | null = null;
    if (field === "publisher") {
      const problem = publisherNameProblem(String(next), context.authors);
      if (problem) {
        checked = false;
        note = `${problem}. Not ticked.`;
      }
    }
    if ((field === "isbn13" || field === "isbn10") && taken.includes(field)) {
      checked = false;
      blocked = `Already on “${context.isbnOwners[field]}”`;
    }
    rows.push({ field, current: now, next, checked, note, blocked });
  }

  // The old ISBN's imprint and country do not describe the new edition
  if (newEdition && had && !taken.length)
    for (const field of ["imprint", "publicationCountry"] as const)
      if (!empty(current[field]))
        rows.push({
          field,
          current: current[field],
          next: null,
          checked: true,
          note: "Belongs to the old ISBN",
          blocked: null,
        });

  if (taken.length) for (const row of rows) row.checked = false;
  rows.sort(
    (a, b) => MATCH_FIELDS.indexOf(a.field) - MATCH_FIELDS.indexOf(b.field),
  );
  return { rows, newEdition, same, warnings };
}
