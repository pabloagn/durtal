import { onlyUndated, type ImportDecision } from "./match-rules";
import type { PreviewRow } from "./page-data";
import { addBookHref, fileLine, outcomeWords, ratingLine, reasonWords, writeLine } from "./preview-text";

/*
 * One preview row as the page sends it to the browser (SLN-450): the words
 * already written, the links already built, and the row's buttons. Small, so
 * 50 rows a section stay within the page budget.
 */

export type RowLineKind = "reason" | "outcome" | "writes" | "rating" | "note";

export interface RowView {
  rowNo: number;
  title: string;
  line: string;
  book: { href: string; title: string; line: string; cover: string | null } | null;
  /** Shown where the book would be, when there is none */
  empty?: string;
  lines: [RowLineKind, string][];
  actions: {
    decision: ImportDecision;
    canImport?: boolean;
    anyway?: boolean;
    canChoose?: boolean;
    candidates?: { workId: string; label: string; score: string }[];
    /** "Use the file's rating", checked or not; left out when the ratings agree */
    ratingChoice?: boolean;
    addHref?: string;
  } | null;
}

/** The outcomes of a written row: "Written (2) · Already in Durtal (Same source)" */
function outcomes(written: NonNullable<PreviewRow["written"]>) {
  const counts = new Map<string, number>();
  for (const r of written.readings) {
    const w = outcomeWords(r.outcome, r.reason);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts].map(([w, n]) => (n > 1 ? `${w} (${n})` : w)).join(" · ");
}

export function rowView(row: PreviewRow, today: string): RowView {
  const { data, match, book, written } = row;
  const anyway = row.section === "present" && onlyUndated(match.verdicts);
  const closed = row.section === "cannot" || row.section === "not_imported";
  const writes = !written && match.verdicts.some((v) => v.verdict === "new");
  const rating = ratingLine({ section: row.section, fileRating: data.rating, bookRating: book?.rating, useFileRating: row.useFileRating, writes });
  const what = written || closed ? null : writeLine(data.readings, match.verdicts, today, { anyway: anyway && row.decision === "import" });
  const reason = reasonWords(match);
  const lines: [RowLineKind, string][] = [];
  if (reason) lines.push(["reason", reason]);
  if (written) lines.push(["outcome", outcomes(written)]);
  if (what) lines.push(["writes", what]);
  if (rating) lines.push(["rating", rating.text]);
  if (!written && match.reason === "Same ISBN" && data.sourceBookId && book?.editionWithoutGoodreads)
    lines.push(["note", `Records Goodreads id ${data.sourceBookId} on this edition`]);
  for (const w of [...data.warnings, ...match.warnings]) lines.push(["note", w]);
  return {
    rowNo: row.rowNo,
    title: data.title || "No title",
    line: fileLine(data, today),
    book: book
      ? {
          href: `/library/${book.slug ?? book.workId}`,
          title: book.title,
          line: [book.author, book.year].filter(Boolean).join(" · ") || "Unknown author",
          cover: book.cover,
        }
      : null,
    ...(book || closed ? {} : { empty: row.section === "choose" ? "Choose a book" : "Not in Durtal" }),
    lines,
    // Only what a row has: 50 rows a section stay light
    actions:
      written || closed
        ? null
        : {
            decision: row.decision,
            ...(book && (row.section !== "present" || anyway) ? { canImport: true } : {}),
            ...(anyway ? { anyway: true } : {}),
            ...(row.section !== "present" ? { canChoose: true } : {}),
            ...(row.candidates.length
              ? {
                  candidates: row.candidates.map((c) => ({
                    workId: c.workId,
                    label: [c.title, c.author, c.year].filter(Boolean).join(", "),
                    score: c.byAuthor ? `${Math.round(c.score * 100)}%` : "Same title",
                  })),
                }
              : {}),
            ...(rating?.choice ? { ratingChoice: row.useFileRating } : {}),
            ...(row.section === "none" && !book ? { addHref: addBookHref(data) } : {}),
          },
  };
}
