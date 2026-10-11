"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button, buttonClass } from "@/components/ui/button";
import type { ReviewBulkAction } from "./review-bulk-dialog";
import type { ReviewAllSource } from "./review-all-dialog";
import { REVIEW_SECTIONS, type ReviewQueueRow, type ReviewSectionKey } from "@/lib/ebooks/review-queue/types";
import { REVIEW_MAX_SHOWN, reviewMoreHref, type ReviewParams } from "@/lib/ebooks/review-queue/params";

export function ReviewSection({ section, count, rows, params, renderRow, onSelectRows, onBulk, onAll }: {
  section: ReviewSectionKey; count: number; rows: ReviewQueueRow[]; params: ReviewParams;
  renderRow: (row: ReviewQueueRow) => ReactNode;
  onSelectRows?: (rows: ReviewQueueRow[]) => void;
  onBulk?: (action: ReviewBulkAction, rows: ReviewQueueRow[]) => void;
  onAll?: (action: ReviewBulkAction, source: ReviewAllSource) => void;
}) {
  if (!count) return null;
  return <section aria-labelledby={`review-section-${section}`} className="space-y-3">
    <SectionHeading id={`review-section-${section}`} title={REVIEW_SECTIONS.find((item) => item.key === section)!.title} count={count}
      action={onSelectRows && rows.some((row) => row.state === "pending" && row.stamp) ?
        <Button size="sm" onClick={() => onSelectRows(rows.filter((row) => row.state === "pending" && row.stamp))}>Select shown</Button> : undefined} />
    {onBulk && ["likely", "duplicate", "not_a_book", "not_in_durtal"].includes(section) && rows.some((row) => row.stamp) &&
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => onBulk(section === "likely" ? "accept" : section === "not_in_durtal" ? "keep" : "exclude",
        rows.filter((row) => row.stamp !== null && (section !== "likely" || row.candidates.length > 0)).slice(0, 50))}>
        {section === "likely" ? "Review shown matches…" : section === "not_in_durtal" ? "Keep shown eBooks…" : "Set aside shown…"}
      </Button></div>}
    {onAll && count > 50 && (section === "likely" || section === "duplicate" || section === "not_a_book" || section === "not_in_durtal") &&
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
    {count > params.shown[section] && params.shown[section] < REVIEW_MAX_SHOWN &&
      <Link href={reviewMoreHref(params, section)} scroll={false} className={buttonClass("secondary", "sm")}>Show 50 more</Link>}
    {count > REVIEW_MAX_SHOWN && params.shown[section] === REVIEW_MAX_SHOWN &&
      <p className="text-xs text-fg-secondary">Showing {REVIEW_MAX_SHOWN}. Narrow the filters to review more.</p>}
  </section>;
}
