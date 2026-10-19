import { toast } from "@/lib/notifications/toast";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { updateWork } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

/**
 * The book's last held copy has just left: say so, and offer to deaccession
 * the book too (SLN-1127). The edit dialog and the status menu both end here.
 */
export function offerBookDeaccession(workId: string, refresh: () => void) {
  toast.success("Copy updated. No copy of this book is held now.", {
    duration: 10000,
    action: {
      label: "Deaccession the book",
      onClick: () => void deaccessionBook(workId, refresh),
    },
  });
}

async function deaccessionBook(workId: string, refresh: () => void) {
  try {
    await updateWork(workId, { catalogueStatus: "deaccessioned" });
    toast.success("Book deaccessioned");
    refresh();
    triggerActivityRefresh();
  } catch (error) {
    toast.error(refusalMessage(error, "Could not deaccession the book"));
  }
}
