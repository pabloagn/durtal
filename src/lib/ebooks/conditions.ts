import { isReadableFormat } from "./formats";
import { isDeliveryFileKey, parseStageKey } from "./keys";
import { medallionOf } from "./medallion";

/** Catalogue fields only: no database connection or object-store access. */
export interface EbookFileEligibility {
  status: string;
  drm: string | null;
  s3Key: string;
  sha256: string;
  format: string;
  metadata?: Record<string, unknown>;
}

/** Recorded delivery eligibility, preserving SLN-569's accepted legacy keys. */
export function isEbookFileDownloadable(file: EbookFileEligibility): boolean {
  if ((file.status !== "stored" && file.status !== "verified") || file.drm)
    return false;
  if (!isDeliveryFileKey(file.s3Key, file.sha256, file.format)) return false;
  if (!parseStageKey(file.s3Key)) return true;
  const stages = medallionOf(file.metadata);
  return (
    !!stages?.validation.downloadable &&
    stages.validation.integrity === "verified" &&
    stages.validation.drm === "clear" &&
    stages.gold.some(
      (object) => object.key === file.s3Key && object.sha256 === file.sha256,
    )
  );
}

/** A stored link or a recognized extension alone never makes a staged file readable. */
export function isEbookFileNativeReadable(file: EbookFileEligibility): boolean {
  if (!isEbookFileDownloadable(file) || !isReadableFormat(file.format))
    return false;
  const stages = medallionOf(file.metadata);
  return !stages || stages.validation.nativeReadable === true;
}
