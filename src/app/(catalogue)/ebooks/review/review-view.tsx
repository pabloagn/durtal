"use client";

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { prepareReviewUi, readReviewUi, confirmReviewUi, undoReviewUi } from "@/lib/actions/ebook-review-ui";
import { ReviewRow, type ReviewRowAction } from "@/components/ebooks/review-row";
import { ReviewSection, ReviewSectionNav } from "@/components/ebooks/review-section";
import { ReviewConfirm } from "@/components/ebooks/review-confirm";
import { effectWords } from "@/lib/ebooks/review/effect-line";
import { ChooseBookFields } from "@/components/ebooks/choose-book-dialog";
import { NewBookFields } from "@/components/ebooks/new-book-dialog";
import { ReviewSelectionBar, selectableReviewRows } from "@/components/ebooks/review-selection-bar";
import { ReviewBulkDialog, type ReviewBulkAction } from "@/components/ebooks/review-bulk-dialog";
import { ReviewBulkUndo } from "@/components/ebooks/review-bulk-undo";
import { WorkReviewDialog } from "@/components/ebooks/work-review-dialog";
import { ReviewAllDialog, type ReviewAllSource } from "@/components/ebooks/review-all-dialog";
import { UnlinkEbookDialog } from "@/components/ebooks/unlink-ebook-dialog";
import type { ReviewUnlinkMode, ReviewUnlinkTarget } from "@/lib/ebooks/review-queue/unlink-types";
import type { WorkReviewOutcome } from "@/lib/ebooks/review/work-service";
import { BookOpenText } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NoResults } from "@/components/shared/no-results";
import { Select } from "@/components/ui/select";
import { REVIEW_KEYS, useReviewKeys, type ReviewKey } from "@/hooks/use-review-keys";
import { initialReviewDecision, reviewDecisionReducer } from "@/lib/ebooks/review-queue/decision-state";
import { reviewParamsSearch, type ReviewParams } from "@/lib/ebooks/review-queue/params";
import type { PrepareEbookReview, PreparedReview, ReviewDetail, ReviewOutcome, ReviewPreparationIssue, ReviewQueue, ReviewQueueRow, ReviewUiResult } from "@/lib/ebooks/review-queue/types";

type Modal = { row: ReviewQueueRow; action: ReviewRowAction; rank?: number };
/** Issues these dialogs show at their own fields, so the dialog's list leaves them out (SLN-684) */
const DIALOG_FIELDS: Partial<Record<ReviewRowAction, readonly ReviewPreparationIssue["field"][]>> = {
  choose: ["workId", "language", "isbn13", "locationId"], new: ["authors", "language"],
};
const titles: Record<ReviewRowAction, string> = { accept: "Review this match", choose: "Choose a book",
  new: "Create a book", keep: "Keep as eBook", exclude: "Set aside", rematch: "Match again" };
const unavailable = <T,>(): ReviewUiResult<T> => ({ ok: false, error: {
  code: "unavailable", message: "This preview could not be loaded. Your choices are kept.", retryOriginal: false,
} });
const uncertain = <T,>(): ReviewUiResult<T> => ({ ok: false, error: {
  code: "outcome_unknown_retry_original", message: "The outcome could not be confirmed. Retry this same decision.", retryOriginal: true,
} });

export function ReviewView({ queue, params, differences }: { queue: ReviewQueue; params: ReviewParams; differences?: ReactNode }) {
  const router = useRouter();
  const [focused, setFocused] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState<Record<string, ReviewDetail>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, { title: string; outcome: ReviewOutcome }>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [bulkModal, setBulkModal] = useState<{ rows: ReviewQueueRow[]; action: ReviewBulkAction; source?: ReviewAllSource } | null>(null);
  const [bulkRuns, setBulkRuns] = useState<{ key: string; outcomes: readonly ReviewOutcome[] }[]>([]);
  const [workModal, setWorkModal] = useState<{ work: NonNullable<ReviewQueueRow["work"]>; original?: WorkReviewOutcome } | null>(null);
  const [workOutcomes, setWorkOutcomes] = useState<Record<string, { work: NonNullable<ReviewQueueRow["work"]>; outcome: WorkReviewOutcome }>>({});
  const [workNotice, setWorkNotice] = useState<string | null>(null);
  const [unlinkModal, setUnlinkModal] = useState<{ target: ReviewUnlinkTarget; mode: ReviewUnlinkMode } | null>(null);
  const [reason, setReason] = useState<"duplicate" | "not_a_book" | "other">("other");
  const [decision, dispatch] = useReducer(reviewDecisionReducer, initialReviewDecision);
  const [undoBusy, setUndoBusy] = useState<string | null>(null);
  const [undoUnknown, setUndoUnknown] = useState<Set<string>>(() => new Set());
  const generation = useRef(0);
  const writeLock = useRef(false);
  const detailCache = useRef(new Map<string, Promise<ReviewUiResult<ReviewDetail>>>());
  const returnTo = `/ebooks/review${reviewParamsSearch(params).size ? `?${reviewParamsSearch(params)}` : ""}`;
  const busy = decision.phase === "confirming" || undoBusy !== null || workModal !== null || unlinkModal !== null;
  const allRows = [...new Map(queue.sections.flatMap((section) => section.rows).map((row) => [row.id, row])).values()];
  const visibleRows = allRows.filter((row) => !removed.has(row.id));
  const selectedVisible = visibleRows.filter((row) => selected.has(row.id));
  const eligibleRows = selectableReviewRows(visibleRows);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!workNotice) return;
    const timer = window.setTimeout(() => setWorkNotice(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [workNotice]);

  function close() {
    if (writeLock.current || decision.phase === "unknown") return;
    dispatch({ type: "edit", generation: ++generation.current }); setModal(null);
  }
  async function detailFor(row: ReviewQueueRow): Promise<ReviewUiResult<ReviewDetail>> {
    if (!row.stamp) return unavailable();
    const key = `${row.id}:${row.stamp.updatedAt}:${row.stamp.matchFingerprint}`;
    let promise = detailCache.current.get(key);
    if (!promise) {
      promise = readReviewUi({ ebookId: row.id, stamp: row.stamp }).catch(() => unavailable<ReviewDetail>());
      detailCache.current.set(key, promise);
    }
    const result = await promise;
    if (result.ok) setDetails((current) => ({ ...current, [row.id]: result.value }));
    else { detailCache.current.delete(key); setErrors((current) => ({ ...current, [row.id]: result.error.message })); }
    return result;
  }
  async function prepareIntent(row: ReviewQueueRow, intent: PrepareEbookReview) {
    if (!row.stamp || writeLock.current || bulkModal || workModal || unlinkModal || decision.phase === "unknown" || undoUnknown.size > 0) return;
    const current = ++generation.current;
    dispatch({ type: "prepare", generation: current });
    const result = await prepareReviewUi({ intent, stamp: row.stamp }).catch(() => unavailable<PreparedReview>());
    dispatch({ type: "prepared", generation: current, result });
  }
  async function begin(row: ReviewQueueRow, action: ReviewRowAction, rank?: number) {
    if (!row.stamp || writeLock.current || bulkModal || workModal || unlinkModal || decision.phase === "unknown" || undoUnknown.size > 0) return;
    setFocused(row.id); setModal({ row, action, rank });
    dispatch({ type: "edit", generation: ++generation.current });
    if (action === "choose" || action === "new" || action === "exclude") {
      setReason(row.tier === "duplicate" ? "duplicate" : row.tier === "not_a_book" ? "not_a_book" : "other");
      return;
    }
    if (action === "accept") {
      const current = ++generation.current;
      dispatch({ type: "prepare", generation: current });
      const detail = await detailFor(row);
      if (current !== generation.current) return;
      if (!detail.ok) { dispatch({ type: "prepared", generation: current, result: detail }); return; }
      const candidate = detail.value.candidates.find((item) => item.rank === (rank ?? 1));
      const shown = row.candidates.find((item) => item.rank === (rank ?? 1));
      if (!candidate?.eligible || candidate.workId !== shown?.workId) {
        dispatch({ type: "prepared", generation: current, result: { ok: false, error: {
          code: "stale_review", message: "This proposal changed or needs another choice. Reload to see it.", retryOriginal: false,
        } } }); return;
      }
      const result = await prepareReviewUi({ stamp: row.stamp,
        intent: { action: "accept", ebookId: row.id, rank: candidate.rank, candidateHash: candidate.candidateHash } }).catch(() => unavailable<PreparedReview>());
      dispatch({ type: "prepared", generation: current, result });
      return;
    }
    await prepareIntent(row, { action, ebookId: row.id });
  }
  async function confirm() {
    if (!modal || !decision.prepared || writeLock.current || !["prepared", "unknown"].includes(decision.phase)) return;
    const prepared = decision.prepared;
    const row = modal.row;
    const current = decision.generation;
    writeLock.current = true; dispatch({ type: "confirm" });
    const result = await confirmReviewUi({ request: prepared.request, previewToken: prepared.previewToken }).catch(() => uncertain<ReviewOutcome>());
    dispatch({ type: "confirmed", generation: current, result }); writeLock.current = false;
    if (!result.ok) { setErrors((existing) => ({ ...existing, [row.id]: result.error.message })); return; }
    setOutcomes((existing) => ({ ...existing, [row.id]: { title: row.title, outcome: result.value } }));
    setAnnouncement(result.value.message); setToast(row.id);
    if (prepared.request.action !== "rematch" && prepared.request.action !== "restore")
      setRemoved((existing) => new Set(existing).add(row.id));
    setSelected((existing) => { const next = new Set(existing); next.delete(row.id); return next; });
    setErrors((existing) => { const next = { ...existing }; delete next[row.id]; return next; });
    setDetails((existing) => { const next = { ...existing }; delete next[row.id]; return next; });
    detailCache.current.clear(); setModal(null); router.refresh();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-review-row]:not([data-review-row="${row.id}"])`)?.focus());
  }
  async function undo(id: string) {
    const original = outcomes[id]?.outcome.undo.originalOperation;
    if (!original || writeLock.current || modal || bulkModal || workModal || unlinkModal || (undoUnknown.size > 0 && !undoUnknown.has(id))) return;
    writeLock.current = true; setUndoBusy(id);
    const result = await undoReviewUi({ ebookId: id, originalOperation: original }).catch(() => uncertain<ReviewOutcome>());
    writeLock.current = false; setUndoBusy(null);
    if (!result.ok) {
      setErrors((existing) => ({ ...existing, [id]: result.error.message }));
      if (result.error.retryOriginal) setUndoUnknown((existing) => new Set(existing).add(id));
      else setUndoUnknown((existing) => { const next = new Set(existing); next.delete(id); return next; });
      return;
    }
    setOutcomes((existing) => { const next = { ...existing }; delete next[id]; return next; });
    setUndoUnknown((existing) => { const next = new Set(existing); next.delete(id); return next; });
    setRemoved((existing) => { const next = new Set(existing); next.delete(id); return next; });
    setErrors((existing) => { const next = { ...existing }; delete next[id]; return next; });
    setToast(null); setAnnouncement(result.value.message); detailCache.current.clear(); router.refresh();
  }
  function onKey(key: ReviewKey) {
    const elements = [...document.querySelectorAll<HTMLElement>("[data-review-row]")];
    const active = document.activeElement?.closest("[data-review-row]");
    const index = elements.findIndex((element) => element === active);
    if (key === "j" || key === "k") {
      const next = index < 0 ? (key === "j" ? 0 : elements.length - 1) :
        Math.max(0, Math.min(elements.length - 1, index + (key === "j" ? 1 : -1)));
      elements[next]?.focus(); return;
    }
    if (key === "u") { const last = Object.keys(outcomes).at(-1); if (last) void undo(last); return; }
    const row = visibleRows.find((item) => item.id === focused);
    if (!row) return;
    if (key === "o") { document.querySelector<HTMLAnchorElement>(`[data-review-open="${row.id}"]`)?.click(); return; }
    if (row.state !== "pending") return;
    if (key === "a" && row.candidates.length === 0) return;
    const actions = { a: "accept", e: "keep", x: "exclude", n: "new", c: "choose" } as const;
    if (key in actions) void begin(row, actions[key as keyof typeof actions]);
  }
  useReviewKeys(onKey, busy || modal !== null || bulkModal !== null || undoUnknown.size > 0);

  function openBulk(action: ReviewBulkAction, rows: ReviewQueueRow[]) {
    if (writeLock.current || modal || bulkModal || workModal || unlinkModal || undoUnknown.size > 0 || !rows.length) return;
    setBulkModal({ action, rows: rows.slice(0, 50) });
  }
  function openAll(action: ReviewBulkAction, source: ReviewAllSource) {
    if (writeLock.current || modal || bulkModal || workModal || unlinkModal || undoUnknown.size > 0) return;
    setBulkModal({ action, source, rows: [] });
  }
  function recordBulk(outcomes: readonly ReviewOutcome[], run: readonly ReviewOutcome[], rows: readonly ReviewQueueRow[] = bulkModal?.rows ?? []) {
    setOutcomes((existing) => ({ ...existing, ...Object.fromEntries(outcomes.map((outcome) => [outcome.ebookId,
      { title: rows.find((row) => row.id === outcome.ebookId)?.title ?? "eBook", outcome }])) }));
    setRemoved((existing) => new Set([...existing, ...outcomes.map((outcome) => outcome.ebookId)]));
    setSelected((existing) => new Set([...existing].filter((id) => !outcomes.some((outcome) => outcome.ebookId === id))));
    const key = run[0]?.operation.operationId;
    if (key) setBulkRuns((existing) => [...existing.filter((item) => item.key !== key), { key, outcomes: run }]);
    const last = outcomes.at(-1); if (last) { setToast(last.ebookId); setAnnouncement(`${run.length} decisions committed.`); }
    detailCache.current.clear(); router.refresh();
  }
  function recordBulkUndo(rows: readonly ReviewOutcome[], originals: readonly ReviewOutcome[]) {
    // Durable replay of an older Undo must not erase a newer local decision.
    const ids = new Set(rows.filter((row) => !outcomes[row.ebookId] ||
      outcomes[row.ebookId].outcome.operation.operationId === originals.find((original) => original.ebookId === row.ebookId)?.operation.operationId)
      .map((row) => row.ebookId));
    setOutcomes((existing) => Object.fromEntries(Object.entries(existing).filter(([id]) => !ids.has(id))));
    setRemoved((existing) => new Set([...existing].filter((id) => !ids.has(id))));
    setErrors((existing) => Object.fromEntries(Object.entries(existing).filter(([id]) => !ids.has(id))));
    setToast(null); setAnnouncement(rows.map((row) => row.message).join(" ")); detailCache.current.clear(); router.refresh();
  }
  function openWork(work: NonNullable<ReviewQueueRow["work"]>, original?: WorkReviewOutcome) {
    if (writeLock.current || modal || bulkModal || workModal || unlinkModal || undoUnknown.size > 0) return;
    setWorkModal({ work, original });
  }
  function openUnlink(row: ReviewQueueRow, mode: ReviewUnlinkMode) {
    if (!row.stamp || !row.matching || row.state !== "linked" || writeLock.current || modal || bulkModal || workModal || unlinkModal || undoUnknown.size > 0) return;
    if (mode === "automatic_undo" && !row.matching.automatic) return;
    setUnlinkModal({ target: { id: row.id, title: row.title, stamp: row.stamp, matching: row.matching,
      book: row.work ? { workId: row.work.id, title: row.work.title } : null }, mode });
  }

  const fieldsDisabled = decision.phase === "preparing" || decision.prepared !== null || busy;
  const toastOutcome = toast ? outcomes[toast] : undefined;
  const toastRun = toast ? bulkRuns.find((run) => run.outcomes.some((outcome) => outcome.ebookId === toast &&
    outcome.operation.operationId === toastOutcome?.outcome.operation.operationId)) : undefined;
  return <div className="space-y-9 pb-24">
    <p aria-live="polite" className="sr-only">{announcement}</p>
    <ReviewSectionNav counts={queue.counts} open={queue.sections[0]?.key ?? null} params={params} />
    {queue.sections.map((section) => {
      const omitted = section.rows.filter((row) => removed.has(row.id)).length;
      return <ReviewSection key={section.key} section={section.key} count={Math.max(0, queue.counts[section.key] - omitted)} page={queue.page}
        onSelectRows={(rows) => setSelected((existing) => new Set([...existing, ...rows.map((row) => row.id)]))}
        onBulk={openBulk} onAll={openAll}
        rows={section.rows.filter((row) => !removed.has(row.id))} params={params} renderRow={(row) =>
          <ReviewRow row={row} section={section.key} detail={details[row.id]?.stamp.updatedAt === row.stamp?.updatedAt &&
            details[row.id]?.stamp.matchFingerprint === row.stamp?.matchFingerprint ? details[row.id] : undefined}
            selected={selected.has(row.id)} focused={focused === row.id} busy={busy || undoUnknown.size > 0} error={errors[row.id]}
            outcome={outcomes[row.id]?.outcome} returnTo={returnTo}
            onFocus={() => { setFocused(row.id); if (row.state === "pending" && !busy && !modal && !bulkModal) void detailFor(row); }}
            onSelect={(value) => setSelected((existing) => { const next = new Set(existing); if (value) next.add(row.id); else next.delete(row.id); return next; })}
            onAction={(action, rank) => void begin(row, action, rank)} onUndo={() => void undo(row.id)}
            onWorkStatus={row.work ? () => openWork(row.work!) : undefined} onUnlink={(mode) => openUnlink(row, mode)} />}
      />;
    })}
    {queue.sections.length === 0 && <ReviewEmpty params={params} />}
    {differences}
    {Object.keys(outcomes).length > 0 && <section aria-label="Recent decisions" className="space-y-2">
      <h2 className="type-section-title">Recent decisions</h2>
      {Object.entries(outcomes).map(([id, entry]) => <div key={id} className="rounded-sm border border-glass-border px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{entry.title} · {effectWords(entry.outcome.message, "done")}</p>
          {entry.outcome.undo.available && <Button size="sm" busy={undoBusy === id}
            disabled={(busy && undoBusy !== id) || modal !== null || (undoUnknown.size > 0 && !undoUnknown.has(id))}
            onClick={() => void undo(id)}>{undoUnknown.has(id) ? "Retry this Undo" : "Undo"}</Button>}
        </div>{errors[id] && <p role="alert" className="mt-1 text-xs text-accent-red-text">{errors[id]}</p>}
      </div>)}
    </section>}
    {bulkRuns.length > 0 && <section aria-label="Review runs" className="space-y-3">
      <h2 className="type-section-title">Review runs</h2>
      {bulkRuns.map((run) => <div key={run.key} className="rounded-sm border border-glass-border p-3">
        <p className="mb-2 text-sm">{run.outcomes.length} committed decisions</p>
        <ReviewBulkUndo runKey={run.key} outcomes={run.outcomes} onUndone={recordBulkUndo}
          disabled={busy || modal !== null || bulkModal !== null || undoUnknown.size > 0}
          onBusy={(value) => { writeLock.current = value; setUndoBusy(value ? run.key : null); }} />
      </div>)}
    </section>}
    {Object.keys(workOutcomes).length > 0 && <section aria-label="Recent book status decisions" className="space-y-2">
      <h2 className="type-section-title">Book status decisions</h2>
      {Object.values(workOutcomes).map(({ work, outcome }) => <div key={work.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-glass-border p-3">
        <p className="text-sm">{work.title} · {outcome.message}</p>
        {outcome.undo.available && <Button size="sm" disabled={busy || modal !== null || bulkModal !== null || undoUnknown.size > 0}
          onClick={() => openWork(work, outcome)}>Undo status change</Button>}
      </div>)}
    </section>}
    {workNotice && <p role="status" className="text-sm text-fg-secondary">{workNotice}</p>}
    <details className="text-xs text-fg-secondary"><summary className="cursor-pointer pointer-coarse:py-3.5">Keyboard shortcuts</summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">{Object.entries(REVIEW_KEYS).map(([key, title]) =>
        <div key={key} className="flex gap-2"><dt><kbd>{key}</kbd></dt><dd>{title}</dd></div>)}</dl>
    </details>
    <ReviewSelectionBar selected={selectedVisible.length} shown={eligibleRows.length}
      rows={selectedVisible} onBulk={(action) => openBulk(action, selectedVisible)}
      onSelectAll={() => setSelected(new Set(eligibleRows.map((row) => row.id)))} onClear={() => setSelected(new Set())}
      onFocus={() => { const id = selectedVisible[0]?.id; if (id) document.querySelector<HTMLElement>(`[data-review-row="${id}"]`)?.focus(); }} />
    {toastOutcome && <div role="status" className="glass fixed bottom-56 left-3 right-3 z-40 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 rounded-sm border border-glass-border px-4 py-3 sm:bottom-24">
      <p className="text-sm">{effectWords(toastOutcome.outcome.message, "done")}</p>
      {toastRun ? <Button size="sm" disabled={busy || modal !== null || bulkModal !== null}
        onClick={() => document.querySelector<HTMLButtonElement>(`[data-review-undo-run="${toastRun.key}"]`)?.click()}>Undo all {toastRun.outcomes.length}</Button> :
        toastOutcome.outcome.undo.available && <Button size="sm" disabled={busy || modal !== null || bulkModal !== null || (undoUnknown.size > 0 && !undoUnknown.has(toast!))} onClick={() => void undo(toast!)}>Undo</Button>}
    </div>}
    {modal && <ReviewConfirm title={`${titles[modal.action]} · ${modal.row.title}`} state={decision}
      fields={DIALOG_FIELDS[modal.action]}
      onClose={close} onConfirm={() => void confirm()} onEdit={() => dispatch({ type: "edit", generation: ++generation.current })}>
      {modal.action === "choose" && <ChooseBookFields key={modal.row.id} row={modal.row} disabled={fieldsDisabled}
        issues={decision.issues.filter((issue) => issue.ebookId === modal.row.id)}
        onPrepare={(intent) => void prepareIntent(modal.row, intent)} />}
      {modal.action === "new" && <NewBookFields key={modal.row.id} row={modal.row} disabled={fieldsDisabled}
        issues={decision.issues.filter((issue) => issue.ebookId === modal.row.id)}
        onPrepare={(intent) => void prepareIntent(modal.row, intent)} />}
      {modal.action === "exclude" && <div className="space-y-3"><Select label="Reason" disabled={fieldsDisabled} value={reason}
        options={[{ value: "duplicate", label: "Duplicate" }, { value: "not_a_book", label: "Not a book" }, { value: "other", label: "Other" }]}
        onChange={(event) => setReason(event.target.value as typeof reason)} />
        {!decision.prepared && <Button variant="primary" disabled={fieldsDisabled}
          onClick={() => void prepareIntent(modal.row, { action: "exclude", ebookId: modal.row.id, reason })}>Preview set aside</Button>}
      </div>}
      {["keep", "rematch"].includes(modal.action) && !decision.prepared && decision.phase !== "preparing" &&
        <Button disabled={busy} onClick={() => void prepareIntent(modal.row, { action: modal.action as "keep" | "rematch", ebookId: modal.row.id })}>Prepare preview</Button>}
      {modal.action === "accept" && !decision.prepared && decision.phase !== "preparing" &&
        <Button disabled={busy} onClick={() => void begin(modal.row, "accept", modal.rank)}>Reload proposal</Button>}
      {modal.action === "accept" && decision.issues.length > 0 &&
        <Button disabled={busy} onClick={() => setModal({ ...modal, action: "choose" })}>Choose edition and copy…</Button>}
    </ReviewConfirm>}
    {bulkModal && !bulkModal.source && <ReviewBulkDialog rows={bulkModal.rows} action={bulkModal.action} onClose={() => setBulkModal(null)}
      onCommitted={recordBulk} onUndone={recordBulkUndo}
      onRefused={(ids, message) => setErrors((existing) => ({ ...existing, ...Object.fromEntries(ids.map((id) => [id, message])) }))} />}
    {bulkModal?.source && <ReviewAllDialog source={bulkModal.source} action={bulkModal.action} onClose={() => setBulkModal(null)}
      onCommitted={recordBulk} onUndone={recordBulkUndo}
      onRefused={(ids, message) => setErrors((existing) => ({ ...existing, ...Object.fromEntries(ids.map((id) => [id, message])) }))} />}
    {workModal && <WorkReviewDialog key={`${workModal.work.id}:${workModal.original?.operation.operationId ?? "prepare"}`}
      work={workModal.work} original={workModal.original} onClose={() => setWorkModal(null)}
      onCommitted={(outcome) => { setWorkOutcomes((existing) => ({ ...existing, [outcome.workId]: { work: workModal.work, outcome } }));
        setAnnouncement(outcome.message); setWorkNotice(outcome.message); router.refresh(); }}
      onUndone={(outcome) => { setWorkOutcomes((existing) => { const next = { ...existing }; delete next[outcome.workId]; return next; });
        setAnnouncement(outcome.message); setWorkNotice(outcome.message); router.refresh(); }} />}
    {unlinkModal && <UnlinkEbookDialog target={unlinkModal.target} initialMode={unlinkModal.mode} onClose={() => setUnlinkModal(null)}
      onCommitted={(outcome) => {
        setOutcomes((existing) => ({ ...existing, [outcome.ebookId]: { title: unlinkModal.target.title, outcome } }));
        setRemoved((existing) => { const next = new Set(existing); next.delete(outcome.ebookId); return next; });
        setSelected((existing) => { const next = new Set(existing); next.delete(outcome.ebookId); return next; });
        setErrors((existing) => { const next = { ...existing }; delete next[outcome.ebookId]; return next; });
        setDetails((existing) => { const next = { ...existing }; delete next[outcome.ebookId]; return next; });
        detailCache.current.clear(); setAnnouncement(outcome.message); setToast(outcome.ebookId); router.refresh();
      }} />}
  </div>;
}

/** Nothing in any section: with a search or filters, a way to clear them */
function ReviewEmpty({ params }: { params: ReviewParams }) {
  const { q, ...rest } = params.filters;
  const hasFilters = Object.values(rest).some(Boolean);
  if (!q && !hasFilters)
    return <EmptyState icon={BookOpenText} title="No eBooks to review"
      description="eBooks you import come here to be matched with your books." heading="h2"
      action={<Link href="/ebooks/upload" className={buttonClass("primary")}>Upload eBooks</Link>} />;
  const clear = reviewParamsSearch({ filters: {}, section: params.section, page: 1 }).toString();
  return <NoResults noun="eBooks" search={q} hasFilters={hasFilters} clearHref={`/ebooks/review${clear ? `?${clear}` : ""}`} />;
}
