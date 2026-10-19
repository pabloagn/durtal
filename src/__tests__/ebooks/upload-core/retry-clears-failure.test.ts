import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { commitTransportCommandOn } from "@/lib/ebooks/upload-core/commands";
import { uploadTargetFingerprint } from "@/lib/ebooks/upload-core/receipts";
import { coreOperationFixture } from "./operation-fixture";

// SLN-1466: a retried check that passed kept the failed check's note, so canceling
// the file later marked its run failed. A retry now clears it; a restart doesn't retry.
const volumeId = "00000000-0000-4000-8000-000000000004", key = "00000000-0000-4000-8000-000000000002";
const bindingSha256 = "b".repeat(64), targetFingerprint = uploadTargetFingerprint("postgresql://fixture@localhost/upload_core_test");
const scope = { volumeId, databaseFingerprint: "d".repeat(64), context: { channel: "ui" as const, bindingSha256, targetFingerprint } };
const owner = { volumeId, bindingSha256, ownerToken: key, ownerFence: 1, leaseExpiresAt: Date.now() + 60_000 };
const dialect = new PgDialect();

/** The statements the command would commit, captured instead of sent */
async function retryStatements(progress: Record<string, unknown>) {
  let sent: SQL[] = [];
  const conn = { execute: (query: SQL) => query, batch: async (queries: SQL[]) => { sent = queries; throw new Error("captured"); } };
  const upload = coreOperationFixture({ volume_id: volumeId, binding_sha256: bindingSha256, target_fingerprint: targetFingerprint,
    state: "failed", generation: 3, progress: progress as never });
  const commandRow = coreOperationFixture({ id: "00000000-0000-4000-8000-000000000009", kind: "retry", parent_operation_id: upload.id,
    volume_id: volumeId, binding_sha256: bindingSha256, target_fingerprint: targetFingerprint, input: { action: "retry", key },
    state: "queued", source_size_bytes: null, ingest_item_id: null, reserved_bytes: 0 });
  await expect(commitTransportCommandOn(conn as unknown as Db, scope, owner as never, upload, commandRow, { action: "retry", key }))
    .rejects.toThrow("captured");
  return sent.map((query) => dialect.sqlToQuery(query));
}

describe("retrying a failed check", () => {
  it("clears the failed check's note in the same write that starts the new check, and keeps the rest", async () => {
    const statements = await retryStatements({ jobFailureV1: { generation: 3, code: "upload_job_failed", reason: "check_failed", what: null }, other: 1 });
    const update = statements.find((q) => q.sql.startsWith("update ebook_upload_operations set state="))!;
    expect(update.params).toContain(JSON.stringify({ other: 1 }));
    expect(update.params).toContain(4);
    // The receipt check asserts the cleared progress, so the write and its proof agree
    expect(statements.some((q) => q.sql.includes("o.progress=") && q.params.includes(JSON.stringify({ other: 1 })))).toBe(true);
    expect(update.params.some((p) => typeof p === "string" && p.includes("jobFailureV1"))).toBe(false);
  });
});
