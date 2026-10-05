import { isOpenStatus } from "../constants";
import { duplicateVerdicts, type ExistingReading } from "../duplicates";
import type { ImportReading, ImportRow, ImportSource } from "./types";

/*
 * The pure half of the import's matching (SLN-450): sections, default
 * decisions and the duplicate verdicts of a book's rows. `match.ts` runs the
 * queries and calls these; the tests call them directly.
 */

/** strict_word_similarity, both ways, for one book to be a likely match */
export const LIKELY_THRESHOLD = 0.8;
/** The same score for a book to be a candidate */
export const CANDIDATE_THRESHOLD = 0.5;
/** Candidates shown on a "To choose" row */
export const MAX_CANDIDATES = 3;

/** How the book was found: by an identifier, by title and author, among several, or not */
export type FoundHow = "exact" | "likely" | "possible" | "none";

/** The preview's sections, in page order */
export const IMPORT_SECTIONS = ["choose", "likely", "none", "exact", "to_read", "present", "cannot", "not_imported"] as const;
export type ImportSection = (typeof IMPORT_SECTIONS)[number];
export const IMPORT_SECTION_LABELS: Record<ImportSection, string> = {
  choose: "To choose",
  likely: "Likely",
  none: "Not in Durtal",
  exact: "Exact",
  to_read: "Want to read",
  present: "Already in Durtal",
  cannot: "Cannot import",
  not_imported: "Not imported",
};

export const IMPORT_DECISIONS = ["pending", "import", "skip"] as const;
export type ImportDecision = (typeof IMPORT_DECISIONS)[number];

export interface MatchCandidate {
  workId: string;
  /** 0 to 1: the title score */
  score: number;
  /** The author's surname matched too */
  byAuthor: boolean;
}

export interface ReadingVerdict {
  n: number;
  verdict: "new" | "already_present" | "refused";
  /** "Same reading", "Same source", "Same finish date", "Undated read", "Already open in Durtal", or why it is refused */
  reason: string | null;
  /** The Durtal reading it matched */
  readingId: string | null;
}

export interface ImportMatch {
  found: FoundHow;
  /** "Same ISBN", "Title and author, 92%" */
  reason: string | null;
  /** The book was chosen by hand */
  chosen: boolean;
  /** The edition matched by ISBN or Goodreads id, or the Durtal file's own */
  editionId: string | null;
  instanceId: string | null;
  candidates: MatchCandidate[];
  /** One per reading of the row, once it has a book */
  verdicts: ReadingVerdict[];
  section: ImportSection;
  /** Why the row is in "Cannot import" or "Already in Durtal" */
  note: string | null;
  /** What matching changed: "Edition not in Durtal; the reading is kept without it" */
  warnings: string[];
  /** A to-read row's book in Up Next and in reading (SLN-452) */
  queue?: QueueState | null;
}

/** Where a to-read row's book stands: its place in Up Next, the row's own key there, an open reading, the last finish */
export interface QueueState {
  place: number | null;
  /** The row's own key is in Up Next: an earlier import of the same file */
  sameKey: boolean;
  open: "reading" | "paused" | null;
  readYear: string | null;
}

/** "Already in Up Next, at 3", "Being read now", "Read in 2019", or null */
export function queueNote(q: QueueState | null | undefined): string | null {
  if (!q) return null;
  if (q.place) return `Already in Up Next, at ${q.place}`;
  if (q.sameKey) return "Already in Up Next";
  if (q.open) return q.open === "paused" ? "Being read now, paused" : "Being read now";
  return q.readYear ? `Read in ${q.readYear}` : null;
}

/** A title as matching compares it, before search_normalize: no series marker, no subtitle after a colon */
export function matchTitle(title: string): string {
  const bare = title.replace(/\s*\([^()]*#\s*\d+(?:\.\d+)?\)\s*$/, "").trim();
  return bare.split(":")[0].trim() || bare || title.trim();
}

/** "Title and author, 92%" */
export function likelyReason(score: number) {
  return `Title and author, ${Math.round(score * 100)}%`;
}

/**
 * The candidates of a title search, best first. Likely when exactly one book
 * passes the bar with its author, or when exactly one has the same title and
 * the others only come close ("The Familiar, Volume 5" among volumes 1 to 4).
 */
export function judgeCandidates(candidates: MatchCandidate[]): { found: FoundHow; workId: string | null; reason: string | null; candidates: MatchCandidate[] } {
  const sorted = [...candidates].sort((a, b) => Number(b.byAuthor) - Number(a.byAuthor) || b.score - a.score);
  const strong = sorted.filter((c) => c.byAuthor && c.score >= LIKELY_THRESHOLD);
  const same = strong.filter((c) => c.score >= 1);
  const one = strong.length === 1 ? strong[0] : same.length === 1 ? same[0] : null;
  if (one) return { found: "likely", workId: one.workId, reason: likelyReason(one.score), candidates: [] };
  const shown = sorted.filter((c) => !c.byAuthor || c.score >= CANDIDATE_THRESHOLD).slice(0, MAX_CANDIDATES);
  if (shown.length) return { found: "possible", workId: null, reason: null, candidates: shown };
  return { found: "none", workId: null, reason: null, candidates: [] };
}

/**
 * The verdict of every reading of a book's rows in one file, rows in file
 * order: the duplicate rule with the count rule, then one open reading per
 * book. A Goodreads or StoryGraph open read for a book already being read is
 * already there; a Durtal file's names another reading, so it is refused.
 */
export function bookVerdicts(
  source: ImportSource,
  rows: { readings: ImportReading[] }[],
  existing: ExistingReading[],
): ReadingVerdict[][] {
  const flat = rows.flatMap((r, i) => r.readings.map((reading) => ({ i, reading })));
  const results = duplicateVerdicts(
    flat.map(({ reading }) => ({
      readingId: reading.readingId,
      sourceKey: reading.sourceKey,
      status: reading.status,
      finishedOn: reading.finishedOn,
      finishedPrecision: reading.finishedPrecision,
    })),
    existing,
    { countRule: true },
  );
  const openExisting = existing.find((e) => isOpenStatus(e.status));
  let openInFile = false;
  const out: ReadingVerdict[][] = rows.map(() => []);
  flat.forEach(({ i, reading }, k) => {
    const r = results[k];
    let verdict: ReadingVerdict = {
      n: reading.n,
      verdict: r.verdict === "already_present" ? "already_present" : "new",
      reason: r.match?.reason ?? null,
      readingId: r.match?.readingId ?? null,
    };
    if (verdict.verdict === "new" && isOpenStatus(reading.status)) {
      if (openExisting)
        verdict =
          source === "durtal"
            ? { n: reading.n, verdict: "refused", reason: "This book already has an open reading", readingId: openExisting.id }
            : { n: reading.n, verdict: "already_present", reason: "Already open in Durtal", readingId: openExisting.id };
      else if (openInFile) verdict = { n: reading.n, verdict: "refused", reason: "This book has another open reading in this file", readingId: null };
      else openInFile = true;
    }
    out[i].push(verdict);
  });
  return out;
}

/** True when the row is "Already in Durtal" only through the undated count, so "Import anyway" applies */
export function onlyUndated(verdicts: ReadingVerdict[]) {
  const present = verdicts.filter((v) => v.verdict === "already_present");
  return present.length > 0 && present.every((v) => v.reason === "Undated read");
}

/** Where a row shows, and why when it cannot be imported or is already there */
export function sectionOf(
  row: Pick<ImportRow, "error" | "kind" | "queueKey">,
  found: FoundHow,
  workId: string | null,
  verdicts: ReadingVerdict[],
  queue: QueueState | null = null,
): { section: ImportSection; note: string | null } {
  if (row.error) return { section: "cannot", note: row.error };
  if (row.kind === "to_read") {
    // A shelf that is neither read nor to-read stays out; to-read rows go to Up Next (SLN-452)
    if (!row.queueKey) return { section: "not_imported", note: "Want to read" };
    if (!workId) return { section: found === "possible" ? "choose" : "none", note: null };
    return { section: "to_read", note: queueNote(queue) };
  }
  const home: ImportSection = found === "exact" ? "exact" : found === "likely" ? "likely" : found === "possible" ? "choose" : "none";
  if (!workId) return { section: home, note: null };
  const refused = verdicts.find((v) => v.verdict === "refused");
  if (refused) return { section: "cannot", note: refused.reason };
  if (verdicts.length && verdicts.every((v) => v.verdict === "already_present"))
    return { section: "present", note: [...new Set(verdicts.map((v) => v.reason))].join(", ") };
  return { section: home, note: null };
}

/**
 * The decision a row starts with: exact rows are imported, and to-read books
 * that are neither queued nor being read; rows that cannot be, or need not
 * be, are skipped
 */
export function defaultDecision(section: ImportSection, queue: QueueState | null = null): ImportDecision {
  if (section === "exact") return "import";
  if (section === "to_read") return queue?.place || queue?.sameKey || queue?.open ? "skip" : "import";
  if (section === "present" || section === "cannot" || section === "not_imported") return "skip";
  return "pending";
}
