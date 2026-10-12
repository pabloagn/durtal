"use client";

import { useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EbookPicker } from "./ebook-picker";
import { EditionChoiceFields, ReviewCopyFields } from "./edition-choice";
import { ReviewConfirm } from "./review-confirm";
import { initialReviewDecision, reviewDecisionReducer } from "@/lib/ebooks/review-queue/decision-state";
import { readReviewWorkOptions, prepareReviewUi, confirmReviewUi } from "@/lib/actions/ebook-review-ui";
import { notifyReviewOutcome } from "@/lib/ebooks/review-queue/feedback";
import type { EditionChoice, PreparedReview, ReviewOutcome, ReviewQueueRow, ReviewUiResult, ReviewWorkOptions } from "@/lib/ebooks/review-queue/types";

export function LinkEbookDialog({ workId, workTitle, onClose, editionId, instanceId }: {
  workId: string; workTitle: string; onClose: () => void; editionId?: string; instanceId?: string;
}) {
  const router = useRouter();
  const [row, setRow] = useState<ReviewQueueRow | null>(null);
  const [options, setOptions] = useState<ReviewWorkOptions | null>(null);
  const [choice, setChoice] = useState<EditionChoice>({ kind: "new_edition" });
  const [locationId, setLocation] = useState("");
  const [state, dispatch] = useReducer(reviewDecisionReducer, initialReviewDecision);
  const [readError, setReadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0); const writeLock = useRef(false);
  const disabled = loading || state.phase === "preparing" || state.phase === "confirming" || state.prepared !== null;
  async function select(selected: ReviewQueueRow | null) {
    const current = ++generation.current; setRow(selected); setOptions(null); setReadError(null);
    dispatch({ type: "edit", generation: current });
    if (!selected) return;
    setLoading(true);
    const result = await readReviewWorkOptions({ workId, ebookId: selected.id }).catch(() => null);
    if (current !== generation.current) return;
    if (result?.ok) {
      setOptions(result.value);
      setChoice(instanceId && editionId ? { kind: "fill_copy", editionId, instanceId } :
        { kind: "new_edition", ...(selected.language ? { language: selected.language } : {}), isbn13: null });
    } else setReadError(result && !result.ok ? result.error.message : "The editions could not be loaded.");
    setLoading(false);
  }
  async function prepare() {
    if (!row?.stamp || !options || writeLock.current || state.phase === "unknown") return;
    const current = ++generation.current; dispatch({ type: "prepare", generation: current });
    const result: ReviewUiResult<PreparedReview> = await prepareReviewUi({ stamp: row.stamp,
      intent: { action: "link", ebookId: row.id, workId, choice, ...(choice.kind !== "fill_copy" && locationId ? { locationId } : {}) },
    }).catch(() => ({ ok: false, error: { code: "unavailable", message: "This preview could not be loaded. Your choices are kept.", retryOriginal: false } }));
    dispatch({ type: "prepared", generation: current, result });
  }
  async function confirm() {
    if (!state.prepared || writeLock.current) return;
    const prepared = state.prepared; const current = state.generation;
    writeLock.current = true; dispatch({ type: "confirm" });
    const result: ReviewUiResult<ReviewOutcome> = await confirmReviewUi({ request: prepared.request, previewToken: prepared.previewToken })
      .catch(() => ({ ok: false, error: { code: "outcome_unknown_retry_original", message: "Retry this same decision to confirm its outcome.", retryOriginal: true } }));
    dispatch({ type: "confirmed", generation: current, result }); writeLock.current = false;
    if (!result.ok) return;
    notifyReviewOutcome(result.value, () => router.refresh());
    onClose(); router.refresh();
  }
  function close() {
    if (writeLock.current || state.phase === "unknown") return;
    generation.current++; onClose();
  }
  return <ReviewConfirm title={`Link an eBook · ${workTitle}`} state={state} onClose={close}
    onConfirm={() => void confirm()} onEdit={() => dispatch({ type: "edit", generation: ++generation.current })}>
    <EbookPicker value={row} disabled={disabled} onChange={(selected) => void select(selected)} />
    {row && options && <div className="space-y-4">
      {instanceId ? <p className="text-sm text-fg-secondary">Fill this existing digital copy. Its current location and descriptive metadata are kept.</p> :
        <><EditionChoiceFields row={row} options={options} choice={choice} onChange={setChoice} disabled={disabled} issues={state.issues} />
          {choice.kind !== "fill_copy" && <ReviewCopyFields options={options} locationId={locationId} onLocation={setLocation} disabled={disabled} issues={state.issues} />}</>}
      {!state.prepared && <Button variant="primary" disabled={disabled} onClick={() => void prepare()}>Preview link</Button>}
    </div>}
    {readError && <p role="alert" className="text-sm text-accent-red-text">{readError}</p>}
  </ReviewConfirm>;
}
