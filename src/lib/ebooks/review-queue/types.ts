import type { z } from "zod/v4";
import type { PrepareEbookReview, ReviewOperation, ebookEditionChoiceSchema, ebookReviewStampSchema } from "@/lib/validations/ebook-review";
import type { prepareEbookReview, ReviewOutcome } from "@/lib/ebooks/review/service";
import type { loadEbookReview } from "@/lib/ebooks/review/queries";
import type { ReviewErrorCode } from "@/lib/ebooks/review/errors";
import type { ReviewPreparationIssue } from "@/lib/ebooks/review/errors";
import type { ExistingCopyStamp } from "@/lib/ebooks/match/manual-intents";

export const REVIEW_SECTIONS = [
  { key: "conflict", title: "Conflicts" },
  { key: "likely", title: "Likely" },
  { key: "to_choose", title: "To choose" },
  { key: "same_author", title: "Same author" },
  { key: "duplicate", title: "Duplicates" },
  { key: "not_a_book", title: "Not a book" },
  { key: "not_in_durtal", title: "Not in Durtal" },
  { key: "automatic", title: "Linked automatically" },
  { key: "partially_held", title: "Partially held" },
] as const;
export type ReviewSectionKey = (typeof REVIEW_SECTIONS)[number]["key"];
export type ReviewStamp = z.output<typeof ebookReviewStampSchema>;
export type EditionChoice = z.output<typeof ebookEditionChoiceSchema>;
export type PreparedReview = Awaited<ReturnType<typeof prepareEbookReview>>;
export type ReviewDetail = Awaited<ReturnType<typeof loadEbookReview>>;
export type ReviewUiCode = ReviewErrorCode | "invalid_input" | "unavailable";
export type ReviewUiResult<T> = { ok: true; value: T } | {
  ok: false; error: { code: ReviewUiCode; message: string; retryOriginal: boolean; ebookIds?: string[]; issues?: readonly ReviewPreparationIssue[] };
};
export type { ReviewPreparationIssue };
export type { PrepareEbookReview, ReviewOperation, ReviewOutcome };

export interface ReviewFile {
  id: string; format: string; sizeBytes: number; status: string; drm: string | null;
  availability: "native" | "download" | "blocked";
  checksum: string; sourcePath: string | null;
}
export interface ReviewEdition {
  id: string; title: string; isbn13: string | null; language: string | null;
  publisher: string | null; year: number | null; placeholder: boolean; locked: boolean;
  copyCount: number;
  copies: { id: string; format: string | null; location: string | null; canFill: boolean; stamp?: ExistingCopyStamp | null }[];
}
export interface ReviewCandidate {
  rank: number; workId: string; title: string; slug: string; authors: string[];
  language: string | null; year: number | null; status: string; probability: number;
  rule: string; modelVersion: number; flags: string[]; reasons: { code: string; text: string }[];
  editionCount: number; editions: ReviewEdition[];
}
export interface ReviewQueueRow {
  id: string; title: string; subtitle: string | null; authors: string[];
  language: string | null; series: string | null; seriesIndex: string | null;
  publisher: string | null; year: number | null; isbns: string[];
  identifiers: Record<string, string[]>; state: "pending" | "linked" | "standalone" | "excluded";
  tier: string | null; stamp: ReviewStamp | null; files: ReviewFile[]; hasCover: boolean;
  candidates: ReviewCandidate[]; duplicate: { id: string; title: string } | null;
  work: { id: string; title: string; slug: string; status: string } | null;
  matching?: { operation: ReviewOperation; automatic: boolean } | null;
}
export interface ReviewQueue {
  counts: Record<ReviewSectionKey, number>;
  /** The open section only: one page of its rows */
  sections: { key: ReviewSectionKey; rows: ReviewQueueRow[] }[];
  /** The page shown of the open section, within its pages */
  page: number;
}
export interface ReviewWorkOptions {
  workId: string; title: string; editionCount: number; editions: ReviewEdition[];
  locations: { id: string; name: string }[];
  isbnHolders: { isbn13: string; workId: string; title: string }[];
}
