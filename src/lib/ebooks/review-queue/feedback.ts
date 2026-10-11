"use client";

import { toast } from "sonner";
import { undoReviewUi } from "@/lib/actions/ebook-review-ui";
import type { ReviewOutcome } from "./types";

export function notifyReviewOutcome(outcome: ReviewOutcome, refresh: () => void) {
  const originalOperation = outcome.undo.originalOperation;
  let pending = false;
  async function undoOriginal() {
    if (pending || !originalOperation) return;
    pending = true;
    const result = await undoReviewUi({ ebookId: outcome.ebookId, originalOperation }).catch(() => null);
    pending = false;
    if (result?.ok) { toast.success(result.value.message); refresh(); return; }
    const retry = result === null || (!result.ok && result.error.retryOriginal);
    toast.error(result && !result.ok ? result.error.message : "Undo could not be confirmed. Retry this same Undo.", {
      duration: retry ? Infinity : 10_000,
      ...(retry ? { action: { label: "Retry Undo", onClick: () => void undoOriginal() } } : {}),
    });
  }
  toast.success(outcome.message, { duration: 10_000,
    ...(originalOperation ? { action: { label: "Undo", onClick: () => void undoOriginal() } } : {}),
  });
}
