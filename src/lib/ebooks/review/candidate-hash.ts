import type { LinkEffect } from "../match/types";
import { reviewPayloadHash } from "./receipts";
/** Same identity in the read model and preparation. Full proposal text is private. */
export function selectedCandidateHash(
  snapshotText: string, rank: number, fingerprint: string | null,
  modelVersion: number, effect: LinkEffect,
): string {
  return reviewPayloadHash({ snapshotText, rank, fingerprint, modelVersion, effect });
}
