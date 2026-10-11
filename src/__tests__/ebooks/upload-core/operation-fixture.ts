import type { CoreOperationRow } from "@/lib/ebooks/upload-core/store";

/** Complete raw operation projection, overridden with each test's real identity. */
export function coreOperationFixture(overrides: Partial<CoreOperationRow> = {}): CoreOperationRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    idempotency_key: "00000000-0000-4000-8000-000000000002",
    kind: "upload", request_sha256: "c".repeat(64), target_fingerprint: "a".repeat(64),
    binding_sha256: "b".repeat(64), protocol_version: 1, parent_operation_id: null,
    volume_id: "00000000-0000-4000-8000-000000000001",
    run_id: "00000000-0000-4000-8000-000000000001",
    ingest_item_id: "00000000-0000-4000-8000-000000000003",
    input: { name: "book.epub", bytes: 10, sha256: "b".repeat(64), target: { kind: "new" } },
    progress: {}, state: "ready", generation: 1, source_size_bytes: 10, reserved_bytes: 553779200,
    revision: 0, lease_token: null, receipt: null, receipt_status: null,
    __retainedUntil: "2030-10-11T10:00:00.123456Z", ...overrides,
  };
}
