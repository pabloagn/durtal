import type { ReviewOperation, ReviewStamp } from "./types";
import type { prepareReviewUnlink } from "@/lib/actions/ebook-review";
export type ReviewUnlinkMode = "automatic_undo" | "unlink";
export interface ReviewUnlinkTarget {
  id: string; title: string; stamp: ReviewStamp;
  matching: { operation: ReviewOperation; automatic: boolean };
  /** The book it is linked to: after an unlink that keeps it, "Link it back" chooses it again (SLN-684) */
  book?: { workId: string; title: string } | null;
}
type ActualPrepared = Awaited<ReturnType<typeof prepareReviewUnlink>>;
export interface PreparedUnlinkReview {
  request: ActualPrepared["request"]; previewToken: string;
  preview: { text: string; keptCopy: boolean; mode: ReviewUnlinkMode; restoredCopy: boolean;
    deleted: { copies: number; editions: number; books: number; authors: number; series: number } };
  capabilities: ActualPrepared["capabilities"];
}
