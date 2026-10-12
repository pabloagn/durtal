"use server";
import { z } from "zod/v4";
import { getReviewExistingCopyContext } from "@/lib/ebooks/review-queue/copy-context-query";
import { reviewUiResult } from "@/lib/ebooks/review-queue/result";
const input = z.strictObject({ workId: z.uuid(), editionId: z.uuid(), instanceId: z.uuid() });
export async function readReviewExistingCopyUi(raw: unknown) {
  return reviewUiResult(async () => getReviewExistingCopyContext(input.parse(raw)));
}
