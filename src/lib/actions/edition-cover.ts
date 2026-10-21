"use server";

import { z } from "zod";
import {
  editionCoverPresentation,
  saveEditionPresentation,
  type editionPresentationSchema,
} from "@/lib/catalogue/edition-cover-presentation";
import {
  switchToBookCover,
  restoreEditionCover,
  isRestorableCover,
  editionCoverChoices,
  restoreSavedEditionCover,
  type OwnCover,
} from "@/lib/catalogue/edition-cover";

/**
 * The edition shows the book's cover (SLN-638). Returns its own cover, and
 * whether `restoreOwnCover` can put it back.
 */
export async function showBookCover(
  editionId: string,
  revision?: string,
): Promise<{
  previous: OwnCover | null;
  restorable: boolean;
}> {
  const { previous } = await switchToBookCover(editionId, revision);
  return {
    previous,
    restorable: !!previous && isRestorableCover(editionId, previous),
  };
}

const key = z.string().min(1).max(1024).nullable();
const ownCoverSchema = z
  .object({
    coverS3Key: key,
    thumbnailS3Key: key,
    coverSourceUrl: z.string().url().max(2048).nullable(),
  })
  .strict();

/** Put back the edition's own cover that `showBookCover` replaced */
export async function restoreOwnCover(
  editionId: string,
  cover: OwnCover,
): Promise<void> {
  await restoreEditionCover(editionId, ownCoverSchema.parse(cover));
}

export async function getEditionCoverChoices(editionId: string, offset = 0) {
  return editionCoverChoices(editionId, offset);
}
export async function restoreSavedCover(
  editionId: string,
  historyId: string,
  revision: string,
) {
  return restoreSavedEditionCover(
    editionId,
    historyId,
    z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(revision),
  );
}
export async function getEditionCoverPresentation(editionId: string) {
  return editionCoverPresentation(editionId);
}
export async function saveEditionCoverPresentation(
  editionId: string,
  input: z.input<typeof editionPresentationSchema>,
  revision: string,
) {
  return saveEditionPresentation(
    editionId,
    input,
    z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(revision),
  );
}
