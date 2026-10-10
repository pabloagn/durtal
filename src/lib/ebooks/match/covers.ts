import { createHash } from "node:crypto";
import type { Db } from "@/lib/catalogue/work-store";
import { allocateCoverStage, requireAllocatedCover, requireVerifiedCover, renderCoverPair,
  stageCoverPair, retainCoverAttempt, type AllocatedCoverStage, type VerifiedCoverStage,
  type CoverSource } from "@/lib/s3/cover-stage";
import { getEbookObjectRange, headEbookObject } from "../storage";
import { acceptedPublication } from "../publication-evidence";
import { matchFileFromStoredRow, type LoadedMatchCatalogue } from "./load";

export interface CoverCopyPlan {
  editionId: string;
  sourceKey: string;
  sourceSha256: string | null;
  sourceSize: number | null;
  coverKey: string;
  thumbnailKey: string;
  allocation: AllocatedCoverStage;
}
export type CopiedCover = VerifiedCoverStage;

function validatedCoverSource(snapshot: Pick<LoadedMatchCatalogue, "rows">, ebookId: string, sourceKey: string): CoverSource {
  const row = snapshot.rows.ebook_files.find((row) => row.ebook_id === ebookId &&
    row.cover_key === sourceKey && matchFileFromStoredRow(row).coverKey === sourceKey);
  if (!row) throw new Error("Cover source does not belong to the validated ebook");
  const publication = acceptedPublication(row.metadata, {
    sha256: String(row.sha256), format: String(row.format), sizeBytes: Number(row.size_bytes),
    s3Key: String(row.s3_key), manifestKey: typeof row.manifest_key === "string" ? row.manifest_key : null,
  });
  const object = publication?.gold.find((object) => object.key === sourceKey);
  return { kind: "ebook", ebookId, key: sourceKey, sha256: object?.sha256 ?? null, size: object?.size ?? null };
}
/** Validate the separate reservation or complete publication against the same
 * protected source/effect and operation. Existing-edition effects cannot adopt. */
export function requireMatchingCover(snapshot: Pick<LoadedMatchCatalogue, "rows">,
  ebookId: string, editionId: string, sourceKey: string | null,
  identity: { operationId: string; targetDatabase: string },
  stage: AllocatedCoverStage | VerifiedCoverStage, complete: boolean) {
  if (!sourceKey) throw new Error("Existing-edition effects cannot publish a cover stage");
  const source = validatedCoverSource(snapshot, ebookId, sourceKey);
  if (complete) requireVerifiedCover(stage as VerifiedCoverStage, editionId, { ...identity, source });
  else {
    requireAllocatedCover(stage);
    if (stage.editionId !== editionId || stage.operationId !== identity.operationId ||
        stage.targetDatabase !== identity.targetDatabase || JSON.stringify(stage.source) !== JSON.stringify(source))
      throw new Error("Cover reservation owner/source/operation/target changed");
  }
}
/** Pure allocation only; source ownership and strict publication lineage were
 * read in the protected callback. No external URL is used for eBook covers. */
export function planCoverCopy(
  snapshot: Pick<LoadedMatchCatalogue, "rows">,
  ebookId: string,
  editionId: string,
  sourceKey: string | null,
  identity: { operationId: string; targetDatabase: string },
): CoverCopyPlan | null {
  if (!sourceKey) return null;
  const source = validatedCoverSource(snapshot, ebookId, sourceKey);
  if (source.kind !== "ebook") throw new Error("Expected ebook source");
  const allocation = allocateCoverStage({ editionId, ...identity, source });
  return { editionId, sourceKey, sourceSha256: source.sha256, sourceSize: source.size,
    coverKey: allocation.coverKey, thumbnailKey: allocation.thumbnailKey, allocation };

}
/** Runs after planning and undo reservation, never inside a read-only callback.
 * Unique attempt keys prevent failed/repeated applies from deleting another
 * successful operation's cover. Source bytes are bounded and hash checked. */
export async function copyPlannedCover(
  plan: CoverCopyPlan,
): Promise<CopiedCover> {
  requireAllocatedCover(plan.allocation);
  if (plan.editionId !== plan.allocation.editionId || plan.coverKey !== plan.allocation.coverKey ||
      plan.thumbnailKey !== plan.allocation.thumbnailKey || plan.allocation.source.kind !== "ebook" ||
      plan.sourceKey !== plan.allocation.source.key || plan.sourceSha256 !== plan.allocation.source.sha256 ||
      plan.sourceSize !== plan.allocation.source.size)
    throw new Error("Cover copy plan changed from its allocated source/owner");
  const head = await headEbookObject(plan.sourceKey, { checksum: true });
  if (
    !head ||
    head.size <= 0 ||
    head.size > 20 * 1024 * 1024 ||
    (plan.sourceSize !== null && head.size !== plan.sourceSize)
  )
    throw new Error("The validated cover is missing or its size changed");
  const expected = plan.sourceSha256 ?? head.sha256 ?? head.metadataSha256;
  if (
    !expected ||
    (plan.sourceSha256 && head.sha256 && head.sha256 !== plan.sourceSha256)
  )
    throw new Error(
      "The validated cover checksum changed or cannot be verified",
    );
  const object = await getEbookObjectRange(plan.sourceKey, 0, head.size - 1);
  if (!object || object.length !== head.size)
    throw new Error("The cover bytes are incomplete");
  const reader = object.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > head.size)
        throw new Error("The cover exceeded its declared size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  if (
    size !== head.size ||
    createHash("sha256").update(bytes).digest("hex") !== expected
  )
    throw new Error("The validated cover bytes changed");
  const { buffers, palette } = await renderCoverPair(bytes);
  return stageCoverPair(plan.allocation, buffers, palette);
}

/** No reference read excludes concurrent alias adoption. Retain even proven
 * currently-unused files and failed/unknown outcomes; never delete covers. */
export async function discardUnusedCover(_conn: Db, plan: CoverCopyPlan) {
  return retainCoverAttempt(plan.allocation, "matching publication rejected or uncertain");
}
