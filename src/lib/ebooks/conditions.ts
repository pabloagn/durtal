import { isEbookFormat, isReadableFormat } from "./formats";
import { isDeliveryFileKey, isSha256, parseStageKey } from "./keys";
import { acceptedPublication, jsonRecord } from "./publication-evidence";
export {
  ebookFileDownloadableCondition,
  ebookFileNativeReadableCondition,
  type EbookFileSqlColumns,
} from "./eligibility-sql";

/** Catalogue fields only: persisted metadata is unknown until validated. */
export interface EbookFileEligibility {
  status: string;
  drm: string | null;
  s3Key: string;
  sha256: string;
  sizeBytes: number;
  format: string;
  metadata?: unknown;
  manifestKey?: string | null;
}

/** Recorded eligibility; storage verification belongs to the publication writer. */
export function isEbookFileDownloadable(file: EbookFileEligibility): boolean {
  try {
    if (
      (file.status !== "stored" && file.status !== "verified") ||
      file.drm !== null ||
      typeof file.s3Key !== "string" ||
      !isSha256(file.sha256) ||
      !isEbookFormat(file.format) ||
      !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes <= 0 ||
      !isDeliveryFileKey(file.s3Key, file.sha256, file.format)
    )
      return false;
    const metadata = file.metadata === undefined ? {} : file.metadata;
    if (!jsonRecord(metadata)) return false;
    if (!parseStageKey(file.s3Key))
      return !Object.hasOwn(metadata, "medallion");
    return acceptedPublication(metadata, file) !== null;
  } catch {
    return false;
  }
}

export function isEbookFileNativeReadable(file: EbookFileEligibility): boolean {
  if (!isEbookFileDownloadable(file) || !isReadableFormat(file.format))
    return false;
  return (
    !parseStageKey(file.s3Key) ||
    acceptedPublication(file.metadata, file)?.validation.nativeReadable === true
  );
}
