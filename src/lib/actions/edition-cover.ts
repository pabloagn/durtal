"use server";

import { z } from "zod";
import {
  switchToBookCover,
  restoreEditionCover,
  isRestorableCover,
  type OwnCover,
} from "@/lib/catalogue/edition-cover";

/**
 * The edition shows the book's cover (SLN-638). Returns its own cover, and
 * whether `restoreOwnCover` can put it back.
 */
export async function showBookCover(editionId: string): Promise<{
  previous: OwnCover | null;
  restorable: boolean;
}> {
  const { previous } = await switchToBookCover(editionId);
  return { previous, restorable: !!previous && isRestorableCover(editionId, previous) };
}

const key = z.string().min(1).max(1024).nullable();
const ownCoverSchema = z.object({
  coverS3Key: key,
  thumbnailS3Key: key,
  coverSourceUrl: z.string().url().max(2048).nullable(),
}).strict();

/** Put back the edition's own cover that `showBookCover` replaced */
export async function restoreOwnCover(editionId: string, cover: OwnCover): Promise<void> {
  await restoreEditionCover(editionId, ownCoverSchema.parse(cover));
}
