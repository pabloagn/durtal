"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { readReviewSelectionPageUi } from "@/lib/actions/ebook-review-pages-ui";
import { ReviewBulkDialog, type ReviewBulkAction } from "./review-bulk-dialog";
import type { ReviewSelectionPageInput } from "@/lib/ebooks/review-queue/params";
import type { ReviewQueueRow, ReviewOutcome } from "@/lib/ebooks/review-queue/types";

export type ReviewAllSource = Omit<ReviewSelectionPageInput, "cursor">;
export function ReviewAllDialog({ source, action, onClose, onCommitted, onUndone, onRefused }: {
  source: ReviewAllSource; action: ReviewBulkAction; onClose: () => void;
  onCommitted: (outcomes: readonly ReviewOutcome[], run: readonly ReviewOutcome[], rows: readonly ReviewQueueRow[]) => void;
  onUndone: (outcomes: readonly ReviewOutcome[], originals: readonly ReviewOutcome[]) => void;
  onRefused: (ids: readonly string[], message: string) => void;
}) {
  const [page, setPage] = useState<ReviewQueueRow[]>([]);
  const [runRows, setRunRows] = useState<ReviewQueueRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false), [loading, setLoading] = useState(false), [showPage, setShowPage] = useState(false);
  const [decided, setDecided] = useState<Set<string>>(() => new Set()), [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState({ committed: 0, skipped: 0 }), [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0), readLock = useRef(false);
  const remaining = page.filter((row) => !decided.has(row.id) && !skipped.has(row.id));
  const unavailable = remaining.filter((row) => !row.stamp);
  async function load() {
    if (readLock.current || remaining.length || (fetched && !nextCursor)) return;
    readLock.current = true; const current = ++generation.current; setLoading(true); setError(null);
    const result = await readReviewSelectionPageUi({ ...source, cursor: nextCursor }).catch(() => null);
    readLock.current = false;
    if (current !== generation.current) return;
    setLoading(false);
    if (result?.ok) { setPage(result.value.rows); setCount(result.value.count); setNextCursor(result.value.nextCursor);
      setDecided(new Set()); setSkipped(new Set()); setFetched(true); }
    else setError(result && !result.ok ? result.error.message : "The next filtered page could not be loaded. Try again.");
  }
  function close() { generation.current++; onClose(); }
  if (showPage) return <ReviewBulkDialog rows={runRows} action={action} allowInlineUndo={false}
    onClose={() => setShowPage(false)} onUndone={onUndone} onRefused={onRefused}
    onSkipped={(ids) => { setSkipped((existing) => new Set([...existing, ...ids]));
      setProgress((value) => ({ ...value, skipped: value.skipped + ids.length })); }}
    onCommitted={(outcomes, run) => { setDecided((existing) => new Set([...existing, ...outcomes.map((row) => row.ebookId)]));
      setProgress((value) => ({ ...value, committed: value.committed + outcomes.length })); onCommitted(outcomes, run, page); }} />;
  return <Dialog open title="Review all filtered eBooks" onClose={close} expandable={false}>
    <div className="space-y-4">
      <p role="status" className="text-sm">{progress.committed} committed · {progress.skipped} explicitly skipped{count !== null ? ` · ${count} pending at the latest page read` : ""}.</p>
      <p className="text-sm text-fg-secondary">Load at most 50 filtered eBooks at a time. Review this page’s titles, then check and confirm each prepared group. New arrivals before the cursor need another pass. Undo remains in the page’s review runs after stopping.</p>
      {remaining.length > 0 && <ul aria-label="Next filtered eBooks" className="max-h-64 space-y-1 overflow-auto text-sm">
        {remaining.map((row) => <li key={row.id}>{row.title} · {row.authors.join(" & ") || "Author unknown"} · {row.language ?? "Language unknown"}</li>)}
      </ul>}
      {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
      {fetched && !remaining.length && !nextCursor && <p className="text-sm">This filtered pass has reached its last page.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={close}>Stop here</Button>
        {unavailable.length > 0 && <Button onClick={() => { setSkipped((existing) => new Set([...existing, ...unavailable.map((row) => row.id)]));
          setProgress((value) => ({ ...value, skipped: value.skipped + unavailable.length })); }}>Skip {unavailable.length} unavailable review rows</Button>}
        {remaining.length > 0 ? <Button variant="primary" disabled={unavailable.length > 0} onClick={() => { setRunRows(remaining); setShowPage(true); }}>Review these {remaining.length} eBooks</Button> :
          (!fetched || nextCursor) && <Button busy={loading} onClick={() => void load()}>Load next 50 filtered eBooks</Button>}
      </div>
    </div>
  </Dialog>;
}
