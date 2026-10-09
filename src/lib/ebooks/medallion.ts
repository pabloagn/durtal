import { createHash } from "node:crypto";
import { isReadableFormat, type EbookFormat } from "./formats";
import { ebookBronzeKey, ebookGoldDerivedKey, ebookGoldFileKey, ebookSilverKey } from "./keys";
import type { PreparedFile, DerivedObject } from "./ingest/prepare";

export const MEDALLION_VERSION = 2;
export interface Validation {
  integrity: "verified" | "unverified";
  drm: "clear" | "protected" | "unverified";
  downloadable: boolean;
  nativeReadable: boolean;
  reason: string | null;
}
export interface StageObject {
  key: string;
  sha256: string;
  size: number;
  contentType: string;
}
export interface Medallion {
  version: number;
  bronze: StageObject;
  silver: StageObject;
  validation: Validation;
  gold: StageObject[];
}
export const hashBytes = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** A recognized file is not necessarily inspected: unsupported integrity/DRM stays unverified. */
export function validationFor(format: EbookFormat, problem: string | null, drm: string | null, inspected: boolean): Validation {
  const accepted = inspected && !problem && !drm;
  return {
    integrity: inspected && !problem ? "verified" : "unverified",
    drm: drm ? "protected" : inspected ? "clear" : "unverified",
    downloadable: accepted,
    nativeReadable: accepted && isReadableFormat(format),
    reason: problem ?? (drm ? `DRM (${drm}): never published` : !inspected ? "Integrity and DRM are not verified for this format" : null),
  };
}

/** No report-dependent keys inside the report: hash it first, then name its publication. */
export function stageFile(
  prepared: PreparedFile,
  metadata: Record<string, unknown>,
  manifest: Uint8Array,
  provenance?: { sourceHost: string; sourcePath: string; sourceMtimeMs: number; plannedAt: string },
) {
  const { sha256, format, size, contentType, validation } = prepared;
  const bronze = {
    key: ebookBronzeKey(sha256, format),
    sha256,
    size,
    contentType,
  };
  const report = JSON.stringify({
    version: MEDALLION_VERSION,
    source: bronze,
    inspectorVersion: prepared.version,
    provenance,
    validation,
    metadata,
    extraction: prepared.text,
    details: prepared.details,
    artifacts: prepared.derived,
  });
  const silver = {
    key: ebookSilverKey(sha256, format, hashBytes(report)),
    sha256: hashBytes(report),
    size: Buffer.byteLength(report),
    contentType: "application/json",
  };
  const derived: (DerivedObject & { key: string })[] = validation.downloadable
    ? prepared.derived
        .filter((d) => d.name !== "manifest.json")
        .map((d) => ({
          ...d,
          key: ebookGoldDerivedKey(sha256, format, silver.sha256, d.name),
        }))
    : [];
  const goldFile = {
    key: ebookGoldFileKey(sha256, format),
    sha256,
    size,
    contentType,
  };
  const publication = JSON.stringify({
    ...JSON.parse(Buffer.from(manifest).toString("utf8")),
    medallion: {
      version: MEDALLION_VERSION,
      bronze,
      silver,
      validation,
      artifacts: [goldFile, ...derived],
    },
  });
  const marker = {
    name: "manifest.json",
    key: ebookGoldDerivedKey(sha256, format, silver.sha256, "manifest.json"),
    sha256: hashBytes(publication),
    size: Buffer.byteLength(publication),
    contentType: "application/json",
  };
  if (validation.downloadable) derived.push(marker);
  const medallion: Medallion = {
    version: MEDALLION_VERSION,
    bronze,
    silver,
    validation,
    gold: validation.downloadable ? [goldFile, ...derived] : [],
  };
  return {
    medallion,
    report,
    publication,
    derived,
    key: validation.downloadable ? goldFile.key : bronze.key,
  };
}

export function medallionOf(metadata: unknown): Medallion | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as { medallion?: Medallion }).medallion;
  return value?.version === MEDALLION_VERSION && value.bronze && value.silver && value.validation && Array.isArray(value.gold) ? value : null;
}
