/**
 * Identify placeholder editions (task 0187). The old import created one
 * edition per book with no ISBN, publisher or cover (metadata source
 * "phantom_canon"). A search returns many editions of a title, in many
 * formats and languages, and sometimes other books; this module keeps the
 * ones that can be the reader's edition and ranks them. Pure module.
 */
import { normalizeSearchText } from "@/lib/utils/search-text";
import { sameBookTitle, publisherNameProblem } from "@/lib/publishers/names";
import { isbn10To13, validIsbn10, validIsbn13 } from "@/lib/match/plan";
import type { MatchCandidate } from "@/lib/match/plan";

/** Metadata source of the placeholder editions of the old import */
export const PLACEHOLDER_SOURCE = "phantom_canon";
/** Metadata source of a placeholder the reader keeps without an ISBN */
export const KEPT_WITHOUT_ISBN = "manual";

export function isPlaceholderEdition(e: {
  metadataSource: string | null;
}): boolean {
  return e.metadataSource === PLACEHOLDER_SOURCE;
}

/** The format a source names, beyond the binding code */
export type CandidateFormat = "print" | "ebook" | "audio" | "unknown";

export function candidateFormat(bindingText: string | null): CandidateFormat {
  const text = bindingText?.toLowerCase() ?? "";
  if (!text.trim() || /unknown/.test(text)) return "unknown";
  if (/\b(audio\w*|cd|mp3|cassette|audible)\b/.test(text)) return "audio";
  if (/\b(kindle|e-?book|epub|digital|online|pdf)\b/.test(text)) return "ebook";
  return "print";
}

/** A search result, cleaned (see cleanRecord), with its authors and format */
export interface RawCandidate extends MatchCandidate {
  authors: string[];
  bindingText: string | null;
  /**
   * How the house this edition links to relates to the house the
   * placeholder already has: the same house (or one above or below it), the
   * same group, another group. Null when either has none.
   */
  house?: "same" | "group" | "other" | null;
}

export interface IdentifyContext {
  workTitle: string;
  authors: string[];
  /** The placeholder's language code */
  language: string;
  /** Every copy is digital: e-books rank first */
  digitalCopies: boolean;
  /** ISBN-13s other editions hold: the title of their book, and whether it is this book */
  owned: Map<string, { title: string; sameWork: boolean }>;
  /** The house the placeholder already links to, often set by hand */
  houseName?: string | null;
}

export interface Candidate extends MatchCandidate {
  isbn13: string;
  authors: string[];
  format: CandidateFormat;
  /** Short reasons to look twice ("Another author") */
  notes: string[];
  score: number;
}

/** "Bernhard, Thomas" and "Thomas Bernhard" share the family name */
function sameAuthor(a: string, b: string) {
  const words = (s: string) =>
    normalizeSearchText(s)
      .split(" ")
      .filter((w) => w.length > 1);
  const x = words(a),
    y = new Set(words(b));
  // The longest word is the family name in nearly every catalogue form
  const family = [...x].sort((p, q) => q.length - p.length)[0];
  return !!family && y.has(family);
}

/**
 * The candidates worth showing, best first. A result is dropped when it has
 * no valid ISBN, when neither its title nor its authors match the book, or
 * when another book in the catalogue already holds its ISBN. An ISBN that
 * another edition of this book holds is dropped too: the queue offers that
 * edition directly.
 */
export function rankCandidates(
  results: RawCandidate[],
  context: IdentifyContext,
  /** The reader typed this ISBN: keep it even when it names another book */
  explicit = false,
): Candidate[] {
  const seen = new Set<string>();
  const ranked: Candidate[] = [];
  for (const r of results) {
    const isbn13 =
      validIsbn13(r.isbn13) ??
      (validIsbn10(r.isbn10) ? isbn10To13(validIsbn10(r.isbn10)!) : null);
    if (!isbn13 || seen.has(isbn13) || context.owned.has(isbn13)) continue;
    const titleMatch = !!r.title && sameBookTitle(r.title, context.workTitle);
    const authorMatch =
      r.authors.length === 0
        ? null
        : r.authors.some((a) => context.authors.some((b) => sameAuthor(b, a)));
    if (!titleMatch && authorMatch !== true && !explicit) continue;
    seen.add(isbn13);

    const notes: string[] = [];
    if (!titleMatch) notes.push("Another title");
    if (authorMatch === false) notes.push("Another author");
    const format = candidateFormat(r.bindingText);
    if (format === "ebook") notes.push("E-book");
    if (format === "audio") notes.push("Audiobook");
    if (r.language && r.language !== context.language)
      notes.push("Another language");
    if (r.house === "other" && context.houseName)
      notes.push(`Not ${context.houseName}`);
    const publisherProblem = r.publisher
      ? publisherNameProblem(r.publisher, context.authors)
      : null;

    let score = 0;
    if (titleMatch) score += 4;
    if (
      r.title &&
      normalizeSearchText(r.title) === normalizeSearchText(context.workTitle)
    )
      score += 2;
    if (authorMatch) score += 4;
    if (r.language === context.language) score += 3;
    else if (r.language) score -= 2;
    if (format === "print") score += context.digitalCopies ? 0 : 3;
    if (format === "ebook") score += context.digitalCopies ? 3 : -3;
    if (format === "audio") score -= 4;
    if (r.house === "same") score += 4;
    if (r.house === "group") score += 1;
    if (r.house === "other") score -= 2;
    if (r.coverUrl) score += 2;
    if (r.publisher && !publisherProblem) score += 1;
    if (r.pageCount) score += 1;
    if (r.publicationYear) score += 0.5;

    ranked.push({
      ...r,
      isbn13,
      format,
      notes,
      score,
    });
  }
  // Best first; equal scores keep the source's order
  return ranked
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.score - a.c.score || a.i - b.i)
    .map(({ c }) => c);
}
