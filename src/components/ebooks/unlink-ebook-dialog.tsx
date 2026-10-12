"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { prepareReviewUnlinkUi, confirmReviewUnlinkUi } from "@/lib/actions/ebook-review-unlink-ui";
import type { ReviewUnlinkTarget, ReviewUnlinkMode, PreparedUnlinkReview } from "@/lib/ebooks/review-queue/unlink-types";
import type { ReviewOutcome } from "@/lib/ebooks/review-queue/types";

export function UnlinkEbookDialog({ target, initialMode, onClose, onCommitted }: {
  target: ReviewUnlinkTarget; initialMode: ReviewUnlinkMode;
  onClose: () => void; onCommitted: (outcome: ReviewOutcome) => void;
}) {
  const [mode, setMode] = useState(initialMode), [prepared, setPrepared] = useState<PreparedUnlinkReview | null>(null);
  const [phase, setPhase] = useState<"editing" | "preparing" | "prepared" | "applying" | "unknown" | "committed">("editing");
  const [error, setError] = useState<string | null>(null), [outcome, setOutcome] = useState<ReviewOutcome | null>(null);
  const generation = useRef(0), lock = useRef(false);
  const locked = phase === "applying" || phase === "unknown";
  function close() { if (!locked && !lock.current) { generation.current++; onClose(); } }
  async function prepare() {
    if (locked || lock.current || phase === "preparing" || phase === "committed") return;
    const current = ++generation.current; setPhase("preparing"); setError(null);
    const result = await prepareReviewUnlinkUi({ intent: { ebookId: target.id, mode,
      originalMatchingOperation: target.matching.operation }, stamp: target.stamp }).catch(() => null);
    if (current !== generation.current) return;
    if (result?.ok) { setPrepared(result.value); setPhase("prepared"); }
    else { setPrepared(null); setPhase("editing"); setError(result && !result.ok ? result.error.message : "This link preview could not be prepared. Reload the eBook before trying again."); }
  }
  async function confirm() {
    if (lock.current || !prepared?.capabilities.canApply || !["prepared", "unknown"].includes(phase)) return;
    const exact = prepared; lock.current = true; setPhase("applying"); setError(null);
    const result = await confirmReviewUnlinkUi({ request: exact.request, previewToken: exact.previewToken }).catch(() => null);
    lock.current = false;
    if (result?.ok) { setOutcome(result.value); setPrepared(null); setPhase("committed"); onCommitted(result.value); }
    else {
      const unknown = result === null || (!result.ok && result.error.retryOriginal);
      setPhase(unknown ? "unknown" : "editing"); if (!unknown) setPrepared(null);
      setError(result && !result.ok ? result.error.message : "The outcome could not be confirmed. Retry this exact unlink decision.");
    }
  }
  return <Dialog open title={`${mode === "automatic_undo" ? "Undo automatic link" : "Unlink eBook"} · ${target.title}`} onClose={close} expandable={false}>
    <div className="space-y-4">
      {!outcome && <p className="text-sm text-fg-secondary">{mode === "automatic_undo"
        ? "Automatic Undo checks the original matching link and refuses later eBook changes."
        : "Fresh Unlink reviews the current link and any copy or catalogue cleanup before confirmation."}</p>}
      {prepared && <div className="space-y-2 rounded-sm border border-glass-border bg-glass-highlight p-4">
        <p className="type-label">What will be written</p><p className="text-sm">{prepared.preview.text}</p>
        {Object.values(prepared.preview.deleted).some((count) => count > 0) && <p className="text-xs text-fg-secondary">Removes {prepared.preview.deleted.copies} copies · {prepared.preview.deleted.editions} editions · {prepared.preview.deleted.books} books · {prepared.preview.deleted.authors} authors · {prepared.preview.deleted.series} series.</p>}
        {prepared.preview.restoredCopy && <p className="text-xs text-fg-secondary">Restores the existing copy’s earlier placement and digital fields.</p>}
        <p className="text-xs text-fg-secondary">This unlink decision has no inverse Undo.</p>
      </div>}
      {outcome && <p role="status" className="text-sm">{outcome.message}{outcome.keptCopy ? " The copy was kept." : ""}</p>}
      {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={locked} onClick={close}>Close</Button>
        {!locked && phase !== "preparing" && phase !== "committed" && mode === "automatic_undo" &&
          <Button onClick={() => { generation.current++; setMode("unlink"); setPrepared(null); setError(null); setPhase("editing"); }}>Choose fresh Unlink instead</Button>}
        {phase === "editing" && <Button onClick={() => void prepare()}>Preview {mode === "automatic_undo" ? "automatic Undo" : "Unlink"}</Button>}
        {phase === "preparing" && <Button disabled>Preparing…</Button>}
        {prepared && <Button variant="primary" disabled={phase === "applying" || !prepared.capabilities.canApply} onClick={() => void confirm()}>
          {phase === "applying" ? "Confirming…" : phase === "unknown" ? "Retry this unlink decision" : "Confirm return to review"}
        </Button>}
      </div>
    </div>
  </Dialog>;
}
