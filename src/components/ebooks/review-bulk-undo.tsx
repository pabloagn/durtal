"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { undoReviewSelectionUi } from "@/lib/actions/ebook-review-selection-ui";
import type { ReviewOutcome } from "@/lib/ebooks/review-queue/types";

/** One bounded original set. A retry sends it unchanged, replaying earlier
 * compensations before the stopped row and never dropping uncertain identity. */
export function ReviewBulkUndo({ outcomes, onUndone, onBusy, disabled, runKey }: {
  outcomes: readonly ReviewOutcome[]; onUndone: (rows: readonly ReviewOutcome[], originals: readonly ReviewOutcome[]) => void;
  onBusy: (value: boolean) => void; disabled?: boolean; runKey?: string;
}) {
  const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState<string | null>(null); const [finished, setFinished] = useState(false);
  const lock = useRef(false);
  const requests = outcomes.flatMap((row) => row.undo.available && row.undo.originalOperation ?
    [{ ebookId: row.ebookId, originalOperation: row.undo.originalOperation }] : []);
  async function undo() {
    if (lock.current || !requests.length) return;
    lock.current = true; setPending(true); onBusy(true);
    const result = await undoReviewSelectionUi({ requests }).catch(() => null);
    lock.current = false; setPending(false);
    if (!result || !result.ok) {
      const unknown = result === null || (!result.ok && result.error.retryOriginal);
      setUncertain(unknown); onBusy(unknown);
      setMessage(result && !result.ok ? result.error.message : "Undo could not be confirmed. Retry this original set.");
      return;
    }
    const committed = result.value.rows.flatMap((row) => row.status === "committed" ? [row.outcome] : []);
    onUndone(committed, outcomes);
    const stopped = result.value.rows.find((row) => row.status !== "committed");
    const unknown = stopped?.status === "unconfirmed";
    setUncertain(unknown); onBusy(unknown);
    if (stopped) setMessage(`${committed.length} undone · ${stopped.message} · ${result.value.deferredRequests.length} still waiting.`);
    else { setFinished(true); setMessage(`${committed.length} decisions undone.`); }
  }
  if (!requests.length) return null;
  return <div className="space-y-1">
    <Button size="sm" disabled={pending || finished || (disabled && !uncertain)} data-review-undo-run={runKey}
      onClick={() => void undo()}>{pending ? "Undoing…" : finished ? "Undone" : uncertain ? "Retry this Undo set" : `Undo all ${requests.length}`}</Button>
    {message && <p role={uncertain ? "alert" : "status"} className="text-xs text-fg-secondary">{message}</p>}
  </div>;
}
