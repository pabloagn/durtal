"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ChooseBookFields } from "./choose-book-dialog";
import { NewBookFields } from "./new-book-dialog";
import { ReviewConfirm } from "./review-confirm";
import { UnlinkEbookButton } from "./unlink-ebook-button";
import { chooseBookNext } from "./choose-book-next";
import { prepareReviewUi, confirmReviewUi } from "@/lib/actions/ebook-review-ui";
import { initialReviewDecision, reviewDecisionReducer } from "@/lib/ebooks/review-queue/decision-state";
import { notifyReviewOutcome } from "@/lib/ebooks/review-queue/feedback";
import type { PrepareEbookReview, PreparedReview, ReviewOutcome, ReviewQueueRow, ReviewUiResult } from "@/lib/ebooks/review-queue/types";

type Action = "choose" | "new" | "keep" | "exclude" | "rematch" | "restore";
const titles: Record<Action, string> = {
  choose: "Choose a book", new: "Create a book", keep: "Keep as eBook",
  exclude: "Set aside", rematch: "Match again", restore: "Restore to review",
};

/** Detail-page glue only. Forms, confirmation, state transitions, services
 * and original-operation Undo remain the approved SLN-505 implementations. */
export function EbookLinkControls({ row }: { row: ReviewQueueRow }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState<"duplicate" | "not_a_book" | "other">("other");
  /** "Link it back": Choose a book starts on the book it was unlinked from */
  const [startWorkId, setStartWorkId] = useState<string | null>(null);
  const [state, dispatch] = useReducer(reviewDecisionReducer, initialReviewDecision);
  const generation = useRef(0), writeLock = useRef(false);
  const locked = state.phase === "confirming" || state.phase === "unknown";
  const busy = locked || state.phase === "preparing";
  function edit() {
    if (locked || writeLock.current) return;
    dispatch({ type: "edit", generation: ++generation.current });
  }
  function close() {
    if (locked || writeLock.current) return;
    edit(); setAction(null); setStartWorkId(null);
  }
  function open(next: Action) {
    if (!row.stamp || action || locked || writeLock.current) return;
    edit(); setReason("other"); setStartWorkId(null); setAction(next);
  }
  async function prepare(intent: PrepareEbookReview) {
    if (!row.stamp || locked || writeLock.current || intent.ebookId !== row.id) return;
    const current = ++generation.current;
    dispatch({ type: "prepare", generation: current });
    const result: ReviewUiResult<PreparedReview> = await prepareReviewUi({ stamp: row.stamp, intent })
      .catch(() => ({ ok: false, error: { code: "unavailable",
        message: "The preview could not be loaded. Your choices are kept.", retryOriginal: false } }));
    dispatch({ type: "prepared", generation: current, result });
  }
  async function confirm() {
    if (!state.prepared || writeLock.current || !["prepared", "unknown"].includes(state.phase)) return;
    // Both first confirmation and uncertain retry send this same request/token.
    const prepared = state.prepared, current = state.generation;
    writeLock.current = true; dispatch({ type: "confirm" });
    const result: ReviewUiResult<ReviewOutcome> = await confirmReviewUi({
      request: prepared.request, previewToken: prepared.previewToken,
    }).catch(() => ({ ok: false, error: { code: "outcome_unknown_retry_original",
      message: "The outcome could not be confirmed. Retry this same decision.", retryOriginal: true } }));
    writeLock.current = false;
    dispatch({ type: "confirmed", generation: current, result });
    if (result.ok) {
      setAction(null);
      notifyReviewOutcome(result.value, () => router.refresh());
      router.refresh();
    }
  }
  // "Change the book…" unlinked it: choose its new book now (SLN-666); or
  // "Link it back": choose the book it had (SLN-684)
  const unlinkedNow = row.state === "pending" || row.state === "standalone";
  useEffect(() => {
    function takeNext() {
      const next = unlinkedNow && row.stamp ? chooseBookNext.take(row.id) : false;
      if (next) {
        edit(); setStartWorkId(next.workId); setAction("choose");
      }
    }
    takeNext();
    // Link it back pressed on this eBook's own page, already showing it unlinked
    return chooseBookNext.subscribe(takeNext);
    // Once, when the refreshed page first shows it unlinked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, unlinkedNow, !!row.stamp]);
  function prepareSimple() {
    if (action === "keep" || action === "rematch")
      void prepare({ action, ebookId: row.id });
    else if (action === "exclude")
      void prepare({ action: "exclude", ebookId: row.id, reason });
    else if (action === "restore" && (row.state === "standalone" || row.state === "excluded"))
      void prepare({ action: "restore", ebookId: row.id, expectedState: row.state });
  }
  if (row.state === "linked") return <UnlinkEbookButton ebookId={row.id} />;
  const unlinked = row.state === "pending" || row.state === "standalone";
  const disabled = !row.stamp || action !== null;
  return <>
    <div className="mt-3 flex flex-wrap gap-2">
      {unlinked && <>
        <Button size="sm" disabled={disabled} onClick={() => open("choose")}>Choose a book…</Button>
        <Button size="sm" disabled={disabled} onClick={() => open("new")}>New book</Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => open("exclude")}>Set aside</Button>
      </>}
      {row.state === "pending" && <>
        <Button size="sm" disabled={disabled} onClick={() => open("keep")}>Keep as eBook</Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => open("rematch")}>Match again</Button>
      </>}
      {(row.state === "standalone" || row.state === "excluded") &&
        <Button size="sm" disabled={disabled} onClick={() => open("restore")}>Restore to review…</Button>}
    </div>
    {!row.stamp && <p role="alert" className="mt-2 text-xs text-accent-red-text">
      This eBook has an invalid review timestamp. Reload before making a decision.
    </p>}
    {action && <ReviewConfirm title={titles[action]} state={state} onClose={close}
      onConfirm={() => void confirm()} onEdit={edit}>
      {!state.prepared && action === "choose" && <ChooseBookFields row={row} disabled={busy} startWorkId={startWorkId}
        issues={state.issues} onPrepare={(intent) => void prepare(intent)} />}
      {!state.prepared && action === "new" && <NewBookFields row={row} disabled={busy}
        issues={state.issues} onPrepare={(intent) => void prepare(intent)} />}
      {!state.prepared && action === "exclude" && <Select label="Reason" value={reason} disabled={busy}
        options={[{ value: "duplicate", label: "Duplicate" }, { value: "not_a_book", label: "Not a book" },
          { value: "other", label: "Other" }]} onChange={(event) => setReason(event.target.value as typeof reason)} />}
      {!state.prepared && !["choose", "new"].includes(action) &&
        <Button disabled={busy} onClick={prepareSimple}>Prepare preview</Button>}
    </ReviewConfirm>}
  </>;
}
