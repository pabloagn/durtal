"use server";

import { z } from "zod/v4";
import { prepareReviewUnlink, confirmReviewUnlink } from "./ebook-review";
import { prepareReviewUnlinkIntentSchema } from "@/lib/ebooks/review/unlink-contract";
import { confirmedReviewUnlinkSchema } from "@/lib/ebooks/review/unlink-service";
import { ebookReviewStampSchema, reviewOperationSchema } from "@/lib/validations/ebook-review";
import { getReviewUnlinkTarget } from "@/lib/ebooks/review-queue/queries";
import { ReviewError } from "@/lib/ebooks/review/errors";
import { requireReviewStamp, reviewUiResult } from "@/lib/ebooks/review-queue/result";
import type { PreparedUnlinkReview } from "@/lib/ebooks/review-queue/unlink-types";

const guarded = z.strictObject({ intent: prepareReviewUnlinkIntentSchema.extend({ originalMatchingOperation: reviewOperationSchema }),
  stamp: ebookReviewStampSchema });
export async function readReviewUnlinkTargetUi(raw: unknown) {
  return reviewUiResult(async () => getReviewUnlinkTarget(z.strictObject({ ebookId: z.uuid() }).parse(raw).ebookId));
}
export async function prepareReviewUnlinkUi(raw: unknown) {
  return reviewUiResult(async (): Promise<PreparedUnlinkReview> => {
    const parsed = guarded.parse(raw), prepared = await prepareReviewUnlink(parsed.intent);
    requireReviewStamp(prepared.request.stamp, parsed.stamp);
    const actual = prepared.request.originalOperation, shown = parsed.intent.originalMatchingOperation;
    if (actual.version !== shown.version || actual.operationId !== shown.operationId || actual.runId !== shown.runId ||
        actual.planSha256 !== shown.planSha256 || actual.targetDatabase !== shown.targetDatabase)
      throw new ReviewError("operation_collision", "The shown native link changed.");
    if (prepared.preview.mode !== parsed.intent.mode)
      throw new ReviewError("invalid_receipt", "The actual preview mode changed.");
    const removed = prepared.preview.deleted;
    // Preserve the actual request/token; project only visible cleanup counts,
    // never the restored-copy row, owned rows or internal cleanup identities.
    return { request: prepared.request, previewToken: prepared.previewToken,
      preview: { text: prepared.preview.text, mode: prepared.preview.mode, keptCopy: prepared.preview.keptCopy,
        restoredCopy: prepared.preview.restoredCopy !== null,
        deleted: { copies: removed.instances.length, editions: removed.editions.length, books: removed.works.length,
          authors: removed.authors.length, series: removed.series.length } }, capabilities: prepared.capabilities };
  });
}
export async function confirmReviewUnlinkUi(raw: unknown) {
  return reviewUiResult(async () => confirmReviewUnlink(confirmedReviewUnlinkSchema.parse(raw)), "write");
}
