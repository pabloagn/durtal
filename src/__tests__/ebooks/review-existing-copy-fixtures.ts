import type { ReviewExistingCopyContext } from "@/lib/ebooks/review-queue/existing-copy";
import { workId } from "./review-ui-fixtures";
export const copyId = "88888888-8888-4888-8888-888888888888";
export const editionId = "66666666-6666-4666-8666-666666666666";
export const locationId = "99999999-9999-4999-8999-999999999999";
export function copyContext(): ReviewExistingCopyContext {
  return { workId, editionId, instanceId: copyId,
    stamp: { updatedAt: "2026-10-11T00:00:00.000001Z", metadataFingerprint: "a".repeat(64) },
    original: { locationId, subLocationId: null, format: "ebook", fileSizeBytes: null, status: "available" },
    metadata: { condition: "mint", hasDustJacket: null, hasSlipcase: null, conditionNotes: null,
      isSigned: false, signedBy: null, inscription: null, isFirstPrinting: false, provenance: null,
      acquisitionType: null, acquisitionDate: null, acquisitionSource: null, acquisitionPrice: null, acquisitionCurrency: null,
      dispositionType: null, dispositionDate: null, dispositionTo: null, dispositionPrice: null, dispositionCurrency: null,
      dispositionNotes: null, notes: "Old note", lentTo: null, lentDate: null } };
}
