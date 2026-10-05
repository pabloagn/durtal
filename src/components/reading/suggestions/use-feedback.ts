"use client";

import { useRouter } from "next/navigation";
import { removeSuggestionFeedback, restoreSuggestionFeedback, setSuggestionFeedback } from "@/lib/actions/suggestions";
import type { FeedbackReason, FeedbackVerdict } from "@/lib/reading/constants";
import type { SuggestionFeedbackSnapshot } from "@/lib/validations/suggestions";
import { showError, undoToast } from "../reading-client";

const DONE: Record<FeedbackVerdict, string> = {
  not_now: "Hidden for 30 days",
  never: "Never suggested again",
  rejected: "Not for you: hidden",
};

/** The way back to the row a verdict replaced, or to none */
export async function undoFeedback(workId: string, previous: SuggestionFeedbackSnapshot | null) {
  if (previous) await restoreSuggestionFeedback(previous);
  else await removeSuggestionFeedback({ workId });
}

/** Records a verdict with a 10-second Undo, then refreshes the page (SLN-457) */
export function useSuggestionFeedback() {
  const router = useRouter();
  return async function give(workId: string, title: string, verdict: FeedbackVerdict, extra: { reasons?: FeedbackReason[]; note?: string | null } = {}) {
    try {
      const previous = await setSuggestionFeedback({ workId, verdict, ...extra });
      router.refresh();
      undoToast(`${title}: ${DONE[verdict].toLowerCase()}`, async () => {
        try {
          await undoFeedback(workId, previous);
          router.refresh();
        } catch (err) {
          showError(err, () => router.refresh());
        }
      });
      return true;
    } catch (err) {
      showError(err, () => router.refresh());
      return false;
    }
  };
}
