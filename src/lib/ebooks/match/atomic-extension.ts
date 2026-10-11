import { requireMatchAtomicExtension, type PreparedMatchAtomicExtension } from "./review-extension";
import { isPreparedUploadAtomicExtension, requireUploadAtomicExtension,
  uploadCompensationOf, uploadForwardUpdatedAt, requireUploadOriginalOperation, type PreparedUploadAtomicExtension } from "../upload/atomic-extension-registry";
export type PreparedCoreAtomicExtension = PreparedMatchAtomicExtension | PreparedUploadAtomicExtension;
/** Distinct upload registry dispatch; the review issuer/registry is unchanged.
 * Upload compensation must never masquerade as an original review decision. */
export function requireCoreAtomicExtension(extension: PreparedCoreAtomicExtension | undefined,
  expected: Parameters<typeof requireMatchAtomicExtension>[1],
): PreparedCoreAtomicExtension | undefined {
  if (isPreparedUploadAtomicExtension(extension)) {
    if (expected.compensation !== undefined || expected.reviewUnlink !== undefined)
      throw new Error("Upload cannot consume review compensation or unlink policy");
    return requireUploadAtomicExtension(extension, { coreWriter: expected.coreWriter,
      coreOperation: expected.coreOperation, ebookIds: expected.ebookIds });
  }
  return requireMatchAtomicExtension(extension, expected);
}
export function uploadCompensation(extension: PreparedCoreAtomicExtension | undefined): boolean {
  return isPreparedUploadAtomicExtension(extension) && uploadCompensationOf(extension);
}
export function hasUploadAtomicExtension(extension: PreparedCoreAtomicExtension | undefined): boolean {
  return isPreparedUploadAtomicExtension(extension);
}
export function uploadTimestamp(extension: PreparedCoreAtomicExtension | undefined, fallback: Date) {
  return isPreparedUploadAtomicExtension(extension) ? uploadForwardUpdatedAt() : fallback;
}
export function requireUploadUndoOriginal(extension: PreparedCoreAtomicExtension, operation: Parameters<typeof requireUploadOriginalOperation>[1]): void {
  if (!isPreparedUploadAtomicExtension(extension)) throw new Error("Upload undo requires its upload capability");
  requireUploadOriginalOperation(extension, operation);
}
