import { contentTypeFor, isEbookFormat, isReadableFormat } from "./formats";
import {
  ebookBronzeKey,
  ebookGoldFileKey,
  ebookSilverKey,
  isSha256,
  parseStageKey,
} from "./keys";
import {
  MEDALLION_VERSION,
  type Medallion,
  type StageObject,
} from "./medallion";

/** JSON records only; arrays, dates and primitive metadata are not catalogue evidence. */
export function jsonRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stageObject(value: unknown): StageObject | null {
  if (
    !jsonRecord(value) ||
    typeof value.key !== "string" ||
    !isSha256(value.sha256) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    typeof value.contentType !== "string"
  )
    return null;
  return {
    key: value.key,
    sha256: value.sha256,
    size: value.size,
    contentType: value.contentType,
  };
}

/**
 * Structural counterpart of SLN-569's plan/publication lineage checks. Reuses
 * its canonical key and checksum validators; never reads or signs an object.
 * Stored/verified rows supply recorded evidence, not a fresh storage check.
 */
export function acceptedPublication(
  metadata: unknown,
  source: {
    sha256: string;
    format: string;
    sizeBytes: number;
    s3Key: string;
    manifestKey?: string | null;
  },
): Medallion | null {
  try {
    if (
      !jsonRecord(metadata) ||
      !jsonRecord(metadata.medallion) ||
      !isSha256(source.sha256) ||
      !isEbookFormat(source.format) ||
      !Number.isSafeInteger(source.sizeBytes) ||
      source.sizeBytes <= 0
    )
      return null;
    const m = metadata.medallion;
    if (
      m.version !== MEDALLION_VERSION ||
      !jsonRecord(m.validation) ||
      !Array.isArray(m.gold) ||
      m.gold.length < 2 ||
      m.gold.length > 5
    )
      return null;
    const validation = m.validation;
    if (
      validation.integrity !== "verified" ||
      validation.drm !== "clear" ||
      validation.downloadable !== true ||
      typeof validation.nativeReadable !== "boolean" ||
      !(validation.reason === null || typeof validation.reason === "string") ||
      (validation.nativeReadable && !isReadableFormat(source.format))
    )
      return null;
    const bronze = stageObject(m.bronze);
    const silver = stageObject(m.silver);
    const objects: StageObject[] = [];
    for (const member of m.gold) {
      const object = stageObject(member);
      if (!object) return null;
      objects.push(object);
    }
    if (!bronze || !silver) return null;
    const expectedType = contentTypeFor(source.format);
    if (
      bronze.key !== ebookBronzeKey(source.sha256, source.format) ||
      bronze.sha256 !== source.sha256 ||
      bronze.size !== source.sizeBytes ||
      bronze.contentType !== expectedType ||
      silver.key !==
        ebookSilverKey(source.sha256, source.format, silver.sha256) ||
      silver.contentType !== "application/json"
    )
      return null;
    const original = objects[0];
    const marker = objects.at(-1)!;
    if (
      original.key !== ebookGoldFileKey(source.sha256, source.format) ||
      original.key !== source.s3Key ||
      original.sha256 !== source.sha256 ||
      original.size !== source.sizeBytes ||
      original.contentType !== expectedType ||
      (source.manifestKey !== undefined && marker.key !== source.manifestKey)
    )
      return null;
    const seen = new Set<string>();
    for (const [index, object] of objects.entries()) {
      if (seen.has(object.key)) return null;
      seen.add(object.key);
      const key = parseStageKey(object.key);
      if (
        !key ||
        key.stage !== "gold" ||
        key.sha256 !== source.sha256 ||
        key.format !== source.format
      )
        return null;
      if (index === 0) {
        if (key.kind !== "file") return null;
      } else {
        if (key.kind !== "derived" || key.reportHash !== silver.sha256)
          return null;
        if (index === objects.length - 1) {
          if (
            key.name !== "manifest.json" ||
            object.contentType !== "application/json"
          )
            return null;
        } else if (
          !key.name?.startsWith("cover-") ||
          object.contentType !== "image/webp"
        )
          return null;
      }
    }
    return {
      version: MEDALLION_VERSION,
      bronze,
      silver,
      gold: objects,
      validation: {
        integrity: "verified",
        drm: "clear",
        downloadable: true,
        nativeReadable: validation.nativeReadable,
        reason: validation.reason,
      },
    };
  } catch {
    // Persisted unknown JSON must refuse eligibility, never crash the page.
    return null;
  }
}
