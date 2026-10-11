import type { UploadAtomicBinding } from "@/lib/ebooks/upload/atomic-extension";
import { registrationPlanSha256, type Registration } from "@/lib/ebooks/ingest/register";
import { reviewPayloadHash } from "@/lib/ebooks/review/receipts";
import { contentTypeFor } from "@/lib/ebooks/formats";
import { publicationFixture } from "../publication-fixture";
export const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const at = "2026-10-11T10:00:00.123456Z";
export function uploadAtomicScenario(offset = 0, sha256?: string) {
  const localId = (n: number) => id(offset + n);
  const publication = publicationFixture("epub", sha256), ebookId = localId(1), fileId = localId(2), jobId = localId(3), commandId = localId(4), runId = localId(5);
  const databaseFingerprint = "0123456789abcdef", targetFingerprint = reviewPayloadHash({ namespace: "durtal.upload.target.v1", database: databaseFingerprint });
  const r: Registration = { ebookId, newEbook: { id: ebookId, title: "Nadja", matchState: "pending", importSource: "upload" },
    inserts: [{ ...publication, contentType: contentTypeFor(publication.format), status: "stored", id: fileId, ebookId, sourcePath: `upload:${jobId}`, createdAt: new Date(at), updatedAt: new Date(at) }],
    replaced: [], preferredBefore: null, coverBefore: null, preferredAfter: fileId, coverAfter: null, updatedBefore: null,
    items: [{ path: `upload:${jobId}`, outcome: "new_ebook", reason: null, ebookId, fileId }], at: new Date(at) };
  const operation = { version: 1 as const, operationId: commandId, runId, planSha256: registrationPlanSha256(r), targetDatabase: databaseFingerprint };
  const file = { id: fileId, ebookId, sha256: publication.sha256, format: publication.format, sizeBytes: publication.sizeBytes,
    s3Key: publication.s3Key, manifestKey: publication.manifestKey, metadata: publication.metadata };
  const inspection = { version: 1, prepared: { sha256: file.sha256, format: file.format, size: file.sizeBytes }, metadata: file.metadata };
  const times = { created_at: at, updated_at: at, lease_token: null, lease_expires_at: null, retention_expires_at: at,
    effect_committed_at: null, cleanup_verified_at: null, reservation_released_at: null };
  const binding: UploadAtomicBinding = { version: 1, purpose: "effect", expiresAt: "2030-10-11T10:00:00.123456Z", databaseFingerprint,
    previewTokenSha256: "b".repeat(64), coreWriter: "registration", coreOperation: operation, ebookIds: [ebookId],
    command: { id: commandId, key: localId(6), requestSha256: "c".repeat(64), targetFingerprint, bindingSha256: "d".repeat(64), volumeId: localId(7), runId,
      rawSnapshot: { ...times, id: commandId, parent_operation_id: jobId, kind: "complete", input: { action: "confirm" },
        idempotency_key: localId(6), request_sha256: "c".repeat(64), target_fingerprint: targetFingerprint, binding_sha256: "d".repeat(64),
        volume_id: localId(7), run_id: runId, protocol_version: 1, receipt: null, receipt_status: null,
        progress: { uploadCoreV1: { previewTokenSha256: "b".repeat(64), expiresAt: "2030-10-11T10:00:00.123456Z", coreOperation: operation, publication: [file] } } } },
    owner: { token: localId(8), fence: 1, capacitySnapshot: { volume_id: localId(7), binding_sha256: "d".repeat(64), owner_token: localId(8), owner_fence: 1,
      owner_lease_expires_at: "2030-10-11T10:00:00.123456Z", worker_lease_expires_at: null, measured_at: at, created_at: at, updated_at: at } },
    job: { id: jobId, generation: 2, mode: "settled", leaseToken: null, rawSnapshot: { ...times, id: jobId, kind: "upload", run_id: runId,
      volume_id: localId(7), binding_sha256: "d".repeat(64), target_fingerprint: targetFingerprint, generation: 2, ingest_item_id: localId(9),
      source_size_bytes: file.sizeBytes, state: "ready", reserved_bytes: 553779200, cleanup_verified_at: at,
      idempotency_key: localId(13), request_sha256: "e".repeat(64), input: { sha256: file.sha256, target: { kind: "new" } }, progress: { inspectionV1: inspection, uploadV1: { writers: {} } },
      receipt: { version: 1, operationId: jobId, status: 200,
        request: { kind: "upload", key: localId(13), requestSha256: "e".repeat(64), targetFingerprint, bindingSha256: "d".repeat(64) },
        result: { operationId: jobId, key: localId(13), status: 200, message: "Verified.", preview: null }, inspectionSha256: reviewPayloadHash(inspection) }, receipt_status: 200 } },
    publication: [file], activityId: localId(10), receipt: { operationId: commandId, key: localId(6), status: 200, message: "Registered.", preview: null },
    targetSnapshot: { ebooks: [], ebook_files: [], ebook_positions: [], ebook_annotations: [], ebook_annotation_retired_ids: [],
      ebook_annotation_cursors: [], reading_notes: [], ebook_ingest_runs: [{ id: runId, kind: "upload", state: "running",
        started_at: at, finished_at: null, updated_at: at }], ebook_ingest_items: [{ id: localId(9), run_id: runId,
        source_path: r.items[0].path, state: "stored", sha256: file.sha256, size_bytes: file.sizeBytes, format: file.format,
        source_mtime: null, created_at: at, updated_at: at }] } };
  return { binding, r, operation };
}
