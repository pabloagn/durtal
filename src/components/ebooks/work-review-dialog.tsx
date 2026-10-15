"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { prepareWorkReviewUi, confirmWorkReviewUi, undoWorkReviewUi } from "@/lib/actions/work-review-ui";
import type { prepareWorkReview } from "@/lib/actions/ebook-review";
import type { WorkReviewOutcome } from "@/lib/ebooks/review/work-service";

type Prepared = Awaited<ReturnType<typeof prepareWorkReview>>;
export function WorkReviewDialog({ work, original, onClose, onCommitted, onUndone }: {
  work: { id: string; title: string; status: string }; original?: WorkReviewOutcome;
  onClose: () => void; onCommitted: (outcome: WorkReviewOutcome) => void; onUndone: (outcome: WorkReviewOutcome) => void;
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [outcome, setOutcome] = useState<WorkReviewOutcome | null>(original ?? null);
  const [phase, setPhase] = useState<"editing" | "preparing" | "prepared" | "applying" | "unknown" | "committed" | "undoing" | "undo_unknown" | "undone">(original ? "committed" : "editing");
  const [error, setError] = useState<string | null>(null);
  /** The write running now retries an unknown outcome: its button keeps saying so */
  const [retrying, setRetrying] = useState(false);
  const lock = useRef(false), generation = useRef(0);
  const locked = ["applying", "unknown", "undoing", "undo_unknown"].includes(phase);
  function close() { if (!lock.current && !locked) { generation.current++; onClose(); } }
  async function prepare() {
    if (lock.current || phase === "preparing" || locked) return;
    const current = ++generation.current; setPhase("preparing"); setError(null);
    const result = await prepareWorkReviewUi({ intent: { action: "mark_accessioned", workId: work.id }, expectedStatus: work.status }).catch(() => null);
    if (current !== generation.current) return;
    if (result?.ok) { setPrepared(result.value); setPhase("prepared"); }
    else { setPhase("editing"); setError(result && !result.ok ? result.error.message : "This status preview could not be loaded. Try again."); }
  }
  async function confirm() {
    if (lock.current || !prepared || !["prepared", "unknown"].includes(phase)) return;
    const exact = prepared; lock.current = true; setRetrying(phase === "unknown"); setPhase("applying"); setError(null);
    const result = await confirmWorkReviewUi({ request: exact.request, previewToken: exact.previewToken }).catch(() => null);
    lock.current = false;
    if (result?.ok) { setOutcome(result.value); setPrepared(null); setPhase("committed"); onCommitted(result.value); }
    else {
      const unknown = result === null || (!result.ok && result.error.retryOriginal);
      setPhase(unknown ? "unknown" : "editing"); if (!unknown) setPrepared(null);
      setError(result && !result.ok ? result.error.message : "The status outcome could not be confirmed. Retry this same operation.");
    }
  }
  async function undo() {
    const originalOperation = outcome?.undo.originalOperation;
    if (lock.current || !originalOperation || !["committed", "undo_unknown"].includes(phase)) return;
    lock.current = true; setRetrying(phase === "undo_unknown"); setPhase("undoing"); setError(null);
    const result = await undoWorkReviewUi({ workId: work.id, originalOperation }).catch(() => null);
    lock.current = false;
    if (result?.ok) { setOutcome(result.value); setPhase("undone"); onUndone(result.value); }
    else {
      setPhase(result === null || (!result.ok && result.error.retryOriginal) ? "undo_unknown" : "committed");
      setError(result && !result.ok ? result.error.message : "Undo could not be confirmed. Retry this original operation.");
    }
  }
  return <Dialog open title={`Catalogue status · ${work.title}`} onClose={close} expandable={false}>
    <div className="space-y-4">
      {prepared && <div className="rounded-sm border border-glass-border bg-glass-highlight p-4">
        <p className="type-label mb-2">{prepared.preview.fromStatus.replaceAll("_", " ")} → {prepared.preview.toStatus}</p>
        <p className="text-sm">{prepared.preview.text}</p>
      </div>}
      {!prepared && !outcome && <p className="text-sm text-fg-secondary">Preview the book’s status change and its history entry before confirming.</p>}
      {outcome && <p role="status" className="text-sm">{outcome.message}</p>}
      {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={close} disabled={locked}>Close</Button>
        {(phase === "editing" || phase === "preparing") &&
          <Button variant="primary" busy={phase === "preparing"} onClick={() => void prepare()}>Preview accessioned status</Button>}
        {prepared && <Button variant="primary" busy={phase === "applying"} onClick={() => void confirm()}>
          {phase === "unknown" || (phase === "applying" && retrying) ? "Retry this status decision" : "Confirm status change"}
        </Button>}
        {outcome?.undo.available && <Button busy={phase === "undoing"} onClick={() => void undo()}>
          {phase === "undo_unknown" || (phase === "undoing" && retrying) ? "Retry this status Undo" : "Undo status change"}
        </Button>}
      </div>
    </div>
  </Dialog>;
}
