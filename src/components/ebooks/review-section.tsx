"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { SectionHeading } from "@/components/shared/section-heading";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import type { ReviewBulkAction } from "./review-bulk-dialog";
import type { ReviewAllSource } from "./review-all-dialog";
import { REVIEW_SECTIONS, type ReviewQueueRow, type ReviewSectionKey } from "@/lib/ebooks/review-queue/types";
import { REVIEW_PAGE_SIZE, reviewPageHref, type ReviewParams } from "@/lib/ebooks/review-queue/params";

/** What each section holds, in words, under its title (SLN-684) */
const descriptions: Partial<Record<ReviewSectionKey, string>> = {
  conflict: "Its ISBN or identifiers contradict the book, or the ISBN is shared by more than one book. Check the file before you link.",
  likely: "A book in Durtal is very probably this eBook. Review the match to link it.",
  to_choose: "More than one book could be this eBook. Choose the right one.",
  same_author: "No title matches, but Durtal has books by the same author.",
  duplicate: "Another eBook is the same book. Set the extra one aside.",
  not_a_book: "Looks like a sample, an article or a periodical rather than a book.",
  not_in_durtal: "No book in Durtal matches. Keep them as eBooks, or add them as new books.",
  automatic: "Linked without asking in the last 30 days, because the match was clear. Undo any that are wrong.",
  partially_held: "Linked to a book that is tracked, wanted, shortlisted or on order. If the eBook is your copy, mark the book accessioned.",
};
export function ReviewSection({ section, count, page, rows, params, renderRow, onSelectRows, onBulk, onAll }: {
  section: ReviewSectionKey; count: number; page: number; rows: ReviewQueueRow[]; params: ReviewParams;
  renderRow: (row: ReviewQueueRow) => ReactNode;
  onSelectRows?: (rows: ReviewQueueRow[]) => void;
  onBulk?: (action: ReviewBulkAction, rows: ReviewQueueRow[]) => void;
  onAll?: (action: ReviewBulkAction, source: ReviewAllSource) => void;
}) {
  if (!count) return null;
  return <section aria-labelledby={`review-section-${section}`} className="space-y-3">
    <SectionHeading id={`review-section-${section}`} title={REVIEW_SECTIONS.find((item) => item.key === section)!.title} count={count}
      description={descriptions[section]}
      action={onSelectRows && rows.some((row) => row.state === "pending" && row.stamp) ?
        <Button size="sm" onClick={() => onSelectRows(rows.filter((row) => row.state === "pending" && row.stamp))}>Select shown</Button> : undefined} />
    {onBulk && ["likely", "duplicate", "not_a_book", "not_in_durtal"].includes(section) && rows.some((row) => row.stamp) &&
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => onBulk(section === "likely" ? "accept" : section === "not_in_durtal" ? "keep" : "exclude",
        rows.filter((row) => row.stamp !== null && (section !== "likely" || row.candidates.length > 0)).slice(0, 50))}>
        {section === "likely" ? "Review shown matches…" : section === "not_in_durtal" ? "Keep shown eBooks…" : "Set aside shown…"}
      </Button></div>}
    {onAll && count > REVIEW_PAGE_SIZE && (section === "likely" || section === "duplicate" || section === "not_a_book" || section === "not_in_durtal") &&
      <Button size="sm" onClick={() => onAll(section === "likely" ? "accept" : section === "not_in_durtal" ? "keep" : "exclude",
        { section, filters: params.filters })}>Review all {count} filtered eBooks…</Button>}
    {rows.map((row, index) => {
      const author = row.authors.join(" & ") || "Author unknown";
      const previous = rows[index - 1];
      const group = section === "not_in_durtal" && (!previous || previous.authors.join(" & ") !== row.authors.join(" & "));
      return <Fragment key={row.id}>
        {group && <div className="flex flex-wrap items-center justify-between gap-2 pt-3"><h3 className="type-item-title">{author}</h3>
          {onBulk && row.authors.length === 1 && <Button size="sm" onClick={() => onBulk("accession",
            rows.filter((item) => item.authors.length === 1 && item.authors[0] === row.authors[0] && item.stamp !== null).slice(0, 50))}>New books for this author…</Button>}
          {onAll && row.authors.length === 1 && <Button size="sm" onClick={() => onAll("accession",
            { section: "not_in_durtal", filters: params.filters, authorName: row.authors[0] })}>All eBooks for this author…</Button>}
        </div>}
        {renderRow(row)}
      </Fragment>;
    })}
    {count > REVIEW_PAGE_SIZE && <Pagination page={page} perPage={REVIEW_PAGE_SIZE} total={count} noun="eBooks" sizes={[]} anchor="review-sections" />}
  </section>;
}

/** The sections with eBooks, one listed at a time (SLN-684) */
export function ReviewSectionNav({ counts, open, params }: {
  counts: Record<ReviewSectionKey, number>; open: ReviewSectionKey | null; params: ReviewParams;
}) {
  const sections = REVIEW_SECTIONS.filter(({ key }) => counts[key] > 0);
  const row = useRef<HTMLUListElement>(null);
  // On a phone the row scrolls inside itself, as the reading tabs do: bring
  // the open section into view, without moving the page
  useEffect(() => {
    const list = row.current, current = list?.querySelector('[aria-current="page"]');
    if (!list || !current) return;
    const past = current.getBoundingClientRect().right - list.getBoundingClientRect().right;
    if (past > 0) list.scrollLeft += past;
  }, [open]);
  if (sections.length < 2) return null;
  return <nav aria-label="Review sections" id="review-sections" className="scroll-mt-6">
    <ul ref={row} className="flex flex-wrap gap-1 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:whitespace-nowrap max-sm:[scrollbar-width:none]">
      {sections.map(({ key, title }) => <li key={key} className="shrink-0">
        <Link href={`${reviewPageHref(params, { section: key })}#review-sections`} scroll={false}
          aria-current={key === open ? "page" : undefined}
          className={`inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors pointer-coarse:h-11 ${
            key === open
              ? "border-accent-primary/10 bg-selection-bg/80 text-fg-primary"
              : "border-transparent text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary"}`}>
          {title}<span className="text-fg-secondary">{counts[key].toLocaleString("en-US")}</span>
        </Link>
      </li>)}
    </ul>
  </nav>;
}
