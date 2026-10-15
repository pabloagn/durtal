"use client";

import { Button } from "@/components/ui/button";
import type { ReviewQueueRow } from "@/lib/ebooks/review-queue/types";
import type { ReviewBulkAction } from "./review-bulk-dialog";
import { X } from "lucide-react";

export function selectableReviewRows(rows: readonly ReviewQueueRow[]): ReviewQueueRow[] {
  return rows.filter((row) => row.state === "pending" && row.stamp !== null);
}
export function ReviewSelectionBar({ selected, shown, onSelectAll, onClear, onFocus, rows = [], onBulk }: {
  selected: number; shown: number; onSelectAll: () => void; onClear: () => void; onFocus: () => void;
  rows?: readonly ReviewQueueRow[]; onBulk?: (action: ReviewBulkAction) => void;
}) {
  if (!selected) return null;
  return <div className="glass fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 rounded-md border border-glass-border px-4 py-3 shadow-lg"
    role="region" aria-label="Selected eBooks">
    <p className="text-sm">{selected} selected{selected > 50 && <span className="block text-xs text-fg-secondary">Next run covers the first 50 shown.</span>}</p>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={onSelectAll}>Select all {shown} shown</Button>
      <Button size="sm" onClick={onFocus}>Review first selected</Button>
      {onBulk && <>
        {rows.length > 0 && rows.every((row) => row.candidates.length > 0) && <Button size="sm" onClick={() => onBulk("accept")}>Review matches…</Button>}
        <Button size="sm" onClick={() => onBulk("keep")}>Keep selected…</Button>
        <Button size="sm" onClick={() => onBulk("exclude")}>Set aside selected…</Button>
        {rows.length > 0 && rows.every((row) => row.authors.length === 1 && row.authors[0] === rows[0].authors[0]) &&
          <Button size="sm" onClick={() => onBulk("accession")}>New books…</Button>}
      </>}
      <Button size="sm" variant="ghost" onClick={onClear}><X aria-hidden strokeWidth={1.5} />Clear</Button>
    </div>
  </div>;
}
