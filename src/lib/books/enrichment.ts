/**
 * Book metadata enrichment (SLN-414): the rules, with no I/O. They read an
 * edition as the catalogue holds it and what the sources say about its ISBN,
 * and decide what may be filled, what only gets reported, and what is held
 * for review. The run itself is `scripts/books/enrich.ts`.
 *
 * The rules, in order:
 * - Never an image, an ISBN, a publisher or an imprint (`EDITION_FILL_COLUMNS`
 *   is the only list the write path takes; a publisher change relinks houses
 *   through the `edition_publisher_identity` trigger, so it stays a report).
 * - Never a locked edition, a placeholder edition (`phantom_canon`, left to
 *   the Identify queue) or an edition without an ISBN.
 * - A source counts only when its record has the edition's exact ISBN and its
 *   title agrees with the edition's.
 * - Only empty fields are filled, with plausible values. Two sources that
 *   disagree hold the field for review. A value that differs from a filled
 *   one is reported, never changed.
 */
import { normalizeSearchText } from "@/lib/utils/search-text";
import type { MatchCandidate } from "@/lib/match/plan";

/** The edition columns a run may write: no image, ISBN, publisher or imprint */
export const EDITION_FILL_COLUMNS = [
  "description",
  "page_count",
  "publication_year",
  "language",
  "binding",
] as const;
export type EditionFillColumn = (typeof EDITION_FILL_COLUMNS)[number];

/** The work columns a run may write */
export const WORK_FILL_COLUMNS = ["description"] as const;
export type WorkFillColumn = (typeof WORK_FILL_COLUMNS)[number];

/** Columns no run ever writes, checked by a unit test against the lists above */
export const NEVER_WRITTEN_COLUMNS = [
  "isbn_13",
  "isbn_10",
  "cover_s3_key",
  "thumbnail_s3_key",
  "cover_source_url",
  "publisher",
  "imprint",
  "publisher_links_confirmed",
  "metadata_locked",
  "work_id",
] as const;

/** Fields that are compared and reported, never filled */
export const REPORTED_ONLY = ["publisher"] as const;

export const BOOK_SOURCES = ["isbndb", "open_library"] as const;
export type BookSource = (typeof BOOK_SOURCES)[number];

export const BOOK_SOURCE_LABEL: Record<BookSource, string> = {
  isbndb: "ISBNdb",
  open_library: "Open Library",
};

/** An edition as the run reads it */
export interface EditionRow {
  id: string;
  workId: string;
  title: string;
  isbn13: string | null;
  isbn10: string | null;
  publisher: string | null;
  publicationYear: number | null;
  pageCount: number | null;
  language: string | null;
  binding: string | null;
  description: string | null;
  metadataLocked: boolean;
  metadataSource: string | null;
  workTitle: string;
  workDescription: string | null;
  workOriginalYear: number | null;
}

export type SourceRecords = Partial<Record<BookSource, MatchCandidate | null>>;

export interface Fill {
  column: EditionFillColumn;
  value: string | number;
  sources: BookSource[];
}
export interface Finding {
  column: EditionFillColumn | (typeof REPORTED_ONLY)[number] | "original_year";
  current: string | number | null;
  found: Partial<Record<BookSource, string | number>>;
  reason: string;
}
export interface EditionPlan {
  editionId: string;
  workId: string;
  /** Why the edition was left alone */
  skipped?: string;
  /** Sources that passed the ISBN and title checks */
  accepted: BookSource[];
  /** Sources that failed them, with the reason */
  rejected: Partial<Record<BookSource, string>>;
  fills: Fill[];
  /** Filled in the work too: its description, when it has none */
  workFills: { column: WorkFillColumn; value: string; sources: BookSource[] }[];
  /** A filled value that differs from the sources: reported, never changed */
  differs: Finding[];
  /** Empty, but the sources disagree or the value is implausible */
  held: Finding[];
}

export const MIN_PAGES = 16;
export const MAX_PAGES = 3000;
export const MIN_YEAR = 1450;
/** A description shorter than this is a stub ("A novel.") */
export const MIN_DESCRIPTION_LENGTH = 80;
/** Page counts of two sources this close agree (front matter, plates) */
export const PAGE_TOLERANCE = 0.05;

/** Placeholder text sources give instead of a description */
const EMPTY_DESCRIPTIONS = [
  /^no description/i,
  /^description not available/i,
  /^not available/i,
  /^n\/a$/i,
];

function words(value: string) {
  return new Set(
    normalizeSearchText(value)
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

/**
 * Whether a source's title is this edition's: one contains the other (a
 * subtitle, "A Novel"), or most of their words are shared.
 */
export function titlesAgree(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = normalizeSearchText(a);
  const nb = normalizeSearchText(b);
  if (!na || !nb) return false;
  if (na === nb || na.startsWith(nb) || nb.startsWith(na)) return true;
  const wa = words(a);
  const wb = words(b);
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.min(wa.size, wb.size) >= 0.75;
}

/** The record has this edition's ISBN, 13 or 10 digits */
export function sameIsbn(edition: Pick<EditionRow, "isbn13" | "isbn10">, record: MatchCandidate) {
  return (
    (!!edition.isbn13 && edition.isbn13 === record.isbn13) ||
    (!!edition.isbn10 && edition.isbn10 === record.isbn10)
  );
}

/** A value fit to fill, or null with the reason it is not */
export function plausible(
  column: EditionFillColumn,
  value: unknown,
  edition: Pick<EditionRow, "workOriginalYear">,
  thisYear = new Date().getFullYear(),
): { ok: true; value: string | number } | { ok: false; reason: string } {
  if (value == null || value === "") return { ok: false, reason: "empty" };
  switch (column) {
    case "page_count": {
      const n = Number(value);
      return Number.isInteger(n) && n >= MIN_PAGES && n <= MAX_PAGES
        ? { ok: true, value: n }
        : { ok: false, reason: `${value} pages is not plausible` };
    }
    case "publication_year": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < MIN_YEAR || n > thisYear + 1)
        return { ok: false, reason: `${value} is not a plausible year` };
      if (edition.workOriginalYear != null && n < edition.workOriginalYear)
        return {
          ok: false,
          reason: `${n} is before the work's original year ${edition.workOriginalYear}`,
        };
      return { ok: true, value: n };
    }
    case "description": {
      const text = String(value).trim();
      if (text.length < MIN_DESCRIPTION_LENGTH)
        return { ok: false, reason: "too short to be a description" };
      if (EMPTY_DESCRIPTIONS.some((re) => re.test(text)))
        return { ok: false, reason: "a placeholder, not a description" };
      return { ok: true, value: text };
    }
    case "language":
    case "binding":
      return { ok: true, value: String(value) };
  }
}

const RECORD_FIELD: Record<EditionFillColumn, keyof MatchCandidate> = {
  description: "description",
  page_count: "pageCount",
  publication_year: "publicationYear",
  language: "language",
  binding: "binding",
};
const ROW_FIELD: Record<EditionFillColumn, keyof EditionRow> = {
  description: "description",
  page_count: "pageCount",
  publication_year: "publicationYear",
  language: "language",
  binding: "binding",
};

/** Two values from different sources say the same */
function agree(column: EditionFillColumn, a: string | number, b: string | number) {
  if (column === "page_count") {
    const x = Number(a);
    const y = Number(b);
    return Math.abs(x - y) <= Math.max(x, y) * PAGE_TOLERANCE;
  }
  if (column === "description")
    return normalizeSearchText(String(a)) === normalizeSearchText(String(b));
  return a === b;
}

function differsFromCurrent(column: EditionFillColumn, current: unknown, found: string | number) {
  if (column === "description")
    return normalizeSearchText(String(current)) !== normalizeSearchText(String(found));
  if (column === "page_count") return !agree(column, Number(current), found);
  return String(current) !== String(found);
}

/** What a run would do to one edition */
export function planEdition(
  edition: EditionRow,
  records: SourceRecords,
  thisYear = new Date().getFullYear(),
): EditionPlan {
  const plan: EditionPlan = {
    editionId: edition.id,
    workId: edition.workId,
    accepted: [],
    rejected: {},
    fills: [],
    workFills: [],
    differs: [],
    held: [],
  };
  if (edition.metadataLocked) return { ...plan, skipped: "metadata locked" };
  if (edition.metadataSource === "phantom_canon")
    return { ...plan, skipped: "placeholder edition (Identify queue)" };
  if (!edition.isbn13 && !edition.isbn10) return { ...plan, skipped: "no ISBN" };

  const usable: [BookSource, MatchCandidate][] = [];
  for (const source of BOOK_SOURCES) {
    const record = records[source];
    if (!record) continue;
    if (!sameIsbn(edition, record)) plan.rejected[source] = "another ISBN";
    else if (!titlesAgree(edition.title, record.title) && !titlesAgree(edition.workTitle, record.title))
      plan.rejected[source] = `title "${record.title ?? ""}" does not match`;
    else usable.push([source, record]);
  }
  plan.accepted = usable.map(([s]) => s);
  if (!usable.length) return plan;

  for (const column of EDITION_FILL_COLUMNS) {
    const current = edition[ROW_FIELD[column]];
    const found: Partial<Record<BookSource, string | number>> = {};
    const rejectedValues: string[] = [];
    for (const [source, record] of usable) {
      const check = plausible(column, record[RECORD_FIELD[column]], edition, thisYear);
      if (check.ok) found[source] = check.value;
      else if (check.reason !== "empty") rejectedValues.push(`${BOOK_SOURCE_LABEL[source]}: ${check.reason}`);
    }
    const values = Object.entries(found) as [BookSource, string | number][];
    const isEmpty = current == null || current === "";

    if (!isEmpty) {
      const different = values.filter(([, v]) => differsFromCurrent(column, current, v));
      if (different.length)
        plan.differs.push({
          column,
          current: current as string | number,
          found: Object.fromEntries(different),
          reason: "the catalogue's value differs; never changed automatically",
        });
      continue;
    }
    if (!values.length) {
      if (rejectedValues.length)
        plan.held.push({ column, current: null, found: {}, reason: rejectedValues.join("; ") });
      continue;
    }
    if (values.length > 1 && !agree(column, values[0][1], values[1][1])) {
      plan.held.push({
        column,
        current: null,
        found: Object.fromEntries(values),
        reason: "the sources disagree",
      });
      continue;
    }
    // Agreeing page counts: the lower one, which leaves out plates and ads
    const value =
      column === "page_count"
        ? Math.min(...values.map(([, v]) => Number(v)))
        : values[0][1];
    plan.fills.push({ column, value, sources: values.map(([s]) => s) });
  }

  // The work's description, when it has none: the same text as the edition's
  const description = plan.fills.find((f) => f.column === "description");
  if (!edition.workDescription?.trim() && typeof description?.value === "string")
    plan.workFills.push({
      column: "description",
      value: description.value,
      sources: description.sources,
    });

  // Publisher: compared and reported only
  const publishers = usable
    .map(([source, r]) => [source, r.publisher] as const)
    .filter(([, p]) => !!p);
  if (edition.publisher && publishers.length) {
    const different = publishers.filter(
      ([, p]) => !titlesAgree(edition.publisher, p) && !titlesAgree(p, edition.publisher),
    );
    if (different.length)
      plan.differs.push({
        column: "publisher",
        current: edition.publisher,
        found: Object.fromEntries(different) as Partial<Record<BookSource, string>>,
        reason: "publisher names differ; publisher links are never changed here",
      });
  } else if (!edition.publisher && publishers.length) {
    plan.held.push({
      column: "publisher",
      current: null,
      found: Object.fromEntries(publishers) as Partial<Record<BookSource, string>>,
      reason: "an empty publisher is left to the publisher name inbox",
    });
  }
  return plan;
}

/**
 * A work whose original year is no earlier than its first edition, and
 * recent, likely holds an edition year (The Brothers Karamazov: 2003).
 * Reported for research, never changed.
 */
export function suspectOriginalYear(
  originalYear: number | null,
  editionYears: (number | null)[],
  recentFrom = 1980,
): string | null {
  if (originalYear == null) return null;
  const years = editionYears.filter((y): y is number => y != null);
  if (!years.length) return null;
  const earliest = Math.min(...years);
  if (originalYear > earliest)
    return `original year ${originalYear} is after its earliest edition (${earliest})`;
  if (originalYear >= recentFrom && years.includes(originalYear))
    return `original year ${originalYear} equals an edition year; it may be the edition's`;
  return null;
}

/** The row values a plan writes, keyed by column: only the allowed columns */
export function editionUpdate(plan: EditionPlan): Partial<Record<EditionFillColumn, string | number>> {
  const update: Partial<Record<EditionFillColumn, string | number>> = {};
  for (const fill of plan.fills) {
    if (!(EDITION_FILL_COLUMNS as readonly string[]).includes(fill.column))
      throw new Error(`Refusing to write ${fill.column}`);
    update[fill.column] = fill.value;
  }
  return update;
}
