"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { NewBookFields } from "./new-book-dialog";
import { ReviewBulkUndo } from "./review-bulk-undo";
import { ReviewIssues } from "./review-issues";
import { prepareReviewSelectionUi, prepareAcceptReviewSelectionUi, confirmReviewSelectionUi } from "@/lib/actions/ebook-review-selection-ui";
import type { PreparedReviewSelection } from "@/lib/ebooks/review/bulk";
import type { PrepareEbookReview, ReviewOutcome, ReviewQueueRow, ReviewPreparationIssue } from "@/lib/ebooks/review-queue/types";
import { countLabel } from "@/lib/utils/format";

export type ReviewBulkAction = "accept" | "keep" | "exclude" | "accession";
const titles = { accept: "Review selected matches", keep: "Keep selected eBooks", exclude: "Set aside selected eBooks", accession: "Create selected books" };
type Phase = "editing" | "preparing" | "prepared" | "applying" | "unknown" | "failed" | "done";
export function ReviewBulkDialog({ rows, action, onClose, onCommitted, onUndone, onRefused, onSkipped, allowInlineUndo = true }: {
  rows: readonly ReviewQueueRow[]; action: ReviewBulkAction; onClose: () => void;
  onCommitted: (outcomes: readonly ReviewOutcome[], run: readonly ReviewOutcome[]) => void;
  onUndone: (outcomes: readonly ReviewOutcome[], originals: readonly ReviewOutcome[]) => void; onRefused: (ids: readonly string[], message: string) => void;
  onSkipped?: (ids: readonly string[]) => void; allowInlineUndo?: boolean;
}) {
  const [remaining, setRemaining] = useState(() => rows.slice(0, 50));
  const [phase, setPhase] = useState<Phase>("editing");
  /** The confirm running now retries an unknown outcome: its button keeps saying so */
  const [retrying, setRetrying] = useState(false);
  const [prepared, setPrepared] = useState<PreparedReviewSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly ReviewPreparationIssue[]>([]);
  const [refusals, setRefusals] = useState<{ id: string; message: string }[]>([]);
  const [changed, setChanged] = useState<string[]>([]);
  const [committed, setCommitted] = useState<ReviewOutcome[]>([]);
  const [deferred, setDeferred] = useState<readonly PrepareEbookReview[] | null>(null);
  const [accession, setAccession] = useState<Extract<PrepareEbookReview, { action: "accession" }> | null>(null);
  const [reason, setReason] = useState<"duplicate" | "not_a_book" | "other">(
    rows.every((row) => row.tier === "duplicate") ? "duplicate" : rows.every((row) => row.tier === "not_a_book") ? "not_a_book" : "other",
  );
  const [undoLocked, setUndoLocked] = useState(false);
  const generation = useRef(0); const writeLock = useRef(false);
  const locked = phase === "applying" || phase === "unknown" || undoLocked;
  const editingDisabled = locked || phase === "preparing" || prepared !== null;
  function close() { if (!locked && !writeLock.current) { generation.current++; onClose(); } }
  async function prepare(choice = accession) {
    if (!remaining.length || writeLock.current || locked || phase === "preparing" || (action === "accession" && !choice)) return;
    const current = ++generation.current; setPhase("preparing"); setError(null); setChanged([]); setIssues([]);
    const first = remaining[0];
    const candidate = first.candidates[0];
    if (action === "accept" && !candidate) {
      const message = "This eBook no longer has a shown match. Skip it or reload its proposals.";
      setPhase("failed"); setError(message); setChanged([first.id]); onRefused([first.id], message); return;
    }
    const intentRows = deferred ?? remaining.map((row): PrepareEbookReview => action === "accession" && choice
      ? { ...choice, ebookId: row.id } : action === "exclude"
        ? { action: "exclude", ebookId: row.id, reason } : { action: "keep", ebookId: row.id });
    const result = await (action === "accept"
      ? prepareAcceptReviewSelectionUi({ ebookId: first.id, stamp: first.stamp, workId: candidate?.workId, rank: candidate?.rank })
      : prepareReviewSelectionUi({ intents: intentRows, stamps: remaining.map((row) => ({ ebookId: row.id, stamp: row.stamp })) }))
      .catch(() => null);
    if (current !== generation.current) return;
    if (result?.ok) { setPrepared(result.value); setPhase("prepared"); }
    else {
      const message = result && !result.ok ? result.error.message : "This selection preview could not be loaded. Your choices are kept.";
      setError(message); setPhase("failed");
      setIssues(result && !result.ok ? result.error.issues ?? [] : []);
      const ids = result && !result.ok ? result.error.ebookIds ?? [...new Set((result.error.issues ?? []).map((issue) => issue.ebookId))] : [];
      setChanged(ids); if (ids.length) onRefused(ids, message);
    }
  }
  async function confirm() {
    if (!prepared || writeLock.current || !["prepared", "unknown"].includes(phase)) return;
    const exact = prepared; writeLock.current = true; setRetrying(phase === "unknown"); setPhase("applying"); setError(null);
    const result = await confirmReviewSelectionUi({ requests: exact.requests, previewToken: exact.previewToken }).catch(() => null);
    writeLock.current = false;
    if (!result || !result.ok) {
      const message = result && !result.ok ? result.error.message : "The outcome could not be confirmed. Retry this same prepared group.";
      const unknown = result === null || (!result.ok && result.error.retryOriginal);
      setError(message); setPhase(unknown ? "unknown" : "failed");
      if (!unknown) { const ids = exact.requests.map((row) => row.ebookId); setChanged(ids); onRefused(ids, message); setPrepared(null); }
      return;
    }
    const outcomes = result.value.outcomes;
    const next = [...committed, ...outcomes];
    const ids = new Set(outcomes.map((row) => row.ebookId));
    const rest = remaining.filter((row) => !ids.has(row.id));
    setCommitted(next); setRemaining(rest); setPrepared(null); setDeferred(action === "accept" ? null : exact.deferredIntents);
    setPhase(rest.length ? "editing" : "done"); onCommitted(outcomes, next);
  }
  function skipChanged() {
    onSkipped?.(changed);
    const rest = remaining.filter((row) => !changed.includes(row.id));
    setRefusals((existing) => [...existing, ...changed.map((id) => ({ id, message: error ?? "This group was refused." }))]);
    setRemaining(rest); setDeferred((intents) => intents?.filter((intent) => !changed.includes(intent.ebookId)) ?? null);
    setChanged([]); setError(null); setPhase(rest.length ? "editing" : "done");
  }
  const first = remaining[0];
  return <Dialog open title={titles[action]} onClose={close} expandable={false} className="max-w-2xl">
    <div className="space-y-4">
      <p role="status" className="text-sm text-fg-secondary">{committed.length} of {Math.min(rows.length, 50)} decided · {remaining.length} waiting{refusals.length ? ` · ${refusals.length} refused` : ""}.</p>
      {action === "exclude" && phase === "editing" && <Select label="Reason for this selection" value={reason} disabled={editingDisabled}
        options={[{ value: "duplicate", label: "Duplicate" }, { value: "not_a_book", label: "Not a book" }, { value: "other", label: "Other" }]}
        onChange={(event) => { setReason(event.target.value as typeof reason); setDeferred(null); }} />}
      {action === "accession" && first && <>
        <p className="text-sm text-fg-secondary">The chosen author and language apply to all {remaining.length} selected eBooks in this group.</p>
        <NewBookFields row={{ ...first, language: remaining.every((row) => row.language === first.language) ? first.language : null }} disabled={editingDisabled}
          issues={issues}
          onPrepare={(choice) => { if (choice.action === "accession") { setAccession(choice); void prepare(choice); } }} />
      </>}
      {prepared && <div className="space-y-3 rounded-sm border border-glass-border bg-glass-highlight p-4">
        <p className="type-label">This confirmation covers {prepared.preparedCount} {prepared.preparedCount === 1 ? "eBook" : "eBooks"}</p>
        {prepared.accessionCounts && <p className="text-sm">{countLabel(prepared.accessionCounts.books, "book")} · {countLabel(prepared.accessionCounts.editions, "edition")} · {countLabel(prepared.accessionCounts.copies, "copy", "copies")} · {countLabel(prepared.accessionCounts.newAuthors, "new author")} · {countLabel(prepared.accessionCounts.newSeries, "new series", "new series")}</p>}
        <ul className="max-h-64 space-y-2 overflow-auto text-sm">{prepared.rows.map((row) => <li key={row.ebookId}>{row.text}
          <span className="block text-xs text-fg-secondary">{[row.format?.toUpperCase(), row.fileSizeBytes !== null ? `${(row.fileSizeBytes / 1024 / 1024).toFixed(1)} MB` : null].filter(Boolean).join(" · ")}</span>
        </li>)}</ul>
        {remaining.length > prepared.preparedCount && <p className="text-xs text-fg-secondary">{remaining.length - prepared.preparedCount} remain deferred. Each next group needs a fresh visible preview after this one commits.</p>}
      </div>}
      {phase === "preparing" && <p role="status" className="text-sm text-fg-secondary">Preparing the next commit group…</p>}
      {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
      <ReviewIssues issues={issues} titles={new Map(rows.map((row) => [row.id, row.title]))} />
      {refusals.length > 0 && <ul aria-label="Refused eBooks" className="space-y-1 text-xs text-fg-secondary">{refusals.map((row) => <li key={row.id}>{rows.find((item) => item.id === row.id)?.title ?? "eBook"} · {row.message}</li>)}</ul>}
      {phase === "done" && allowInlineUndo && <ReviewBulkUndo outcomes={committed} onUndone={onUndone} onBusy={setUndoLocked} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={close} disabled={locked}>{phase === "done" ? "Close" : "Stop here"}</Button>
        {!locked && phase !== "preparing" && remaining.length > 0 && (prepared || accession) &&
          <Button variant="ghost" onClick={() => { generation.current++; setPrepared(null); setAccession(null); setDeferred(null); setChanged([]); setError(null); setPhase("editing"); }}>Change choices</Button>}
        {changed.length > 0 && !locked && <Button onClick={skipChanged}>Skip these {changed.length} refused eBooks</Button>}
        {remaining.length > 0 && !prepared && changed.length === 0 && action !== "accession" &&
          <Button variant="primary" disabled={editingDisabled} onClick={() => void prepare()}>Preview next group</Button>}
        {prepared && <Button variant="primary" busy={phase === "applying"} disabled={phase !== "prepared" && phase !== "unknown" && phase !== "applying"} onClick={() => void confirm()}>
          {phase === "unknown" || (phase === "applying" && retrying) ? "Retry this same group" : `Confirm ${prepared.preparedCount} ${prepared.preparedCount === 1 ? "decision" : "decisions"}`}
        </Button>}
      </div>
    </div>
  </Dialog>;
}
