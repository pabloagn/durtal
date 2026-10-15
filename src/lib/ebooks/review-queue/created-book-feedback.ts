"use client";
import { toast } from "@/lib/notifications/toast";
import { refreshSuggestionsForCreatedBook } from "@/lib/actions/ebook-review-suggestions";
/** Called only with the confirmed create result. Suggestion availability never
 * turns a saved book into a failed create or another create attempt. */
export async function notifyCreatedBookSuggestions(workId: string, openReview: (href: string) => void) {
  const outcome = await refreshSuggestionsForCreatedBook({ workId }).catch(() => null);
  if (!outcome || outcome.status === "unavailable") {
    toast.info("Book added. eBook suggestions could not be checked yet.");
    return;
  }
  if (outcome.suggestionCount > 0) toast.info(`${outcome.suggestionCount} ${outcome.suggestionCount === 1 ? "eBook suggestion" : "eBook suggestions"} for this book`, {
    duration: 10_000, action: { label: "Review", onClick: () => openReview(`/ebooks/review?work=${outcome.workId}`) },
  });
}
