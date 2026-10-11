import type { CreateUploadBatch, UploadBatchView, UploadCommand, UploadOutcome, UploadItemView } from "./protocol";

/** Pending actual 494/495/496 adapter, not an alternate registration writer.
 * Implementations must use the inspected upstream core entry points and the
 * core-issued atomic upload extension specified in task 0445. No default or
 * in-memory implementation is supplied. Root installs the reviewed adapter.
 */
export interface UploadCoreContext {
  readonly channel: "ui" | "api";
  readonly targetFingerprint: string;
  readonly bindingSha256: string;
}
export interface UploadCoreAdapter {
  /** One atomic real ingest run/items + permanent 201 creation receipt. Return
   * the frozen original creation view on replay; readBatch supplies live state.
   */
  createBatch(input: CreateUploadBatch, context: UploadCoreContext): Promise<UploadBatchView>;
  readBatch(batchId: string, context: UploadCoreContext): Promise<UploadBatchView | null>;
  readItem(operationId: string, context: UploadCoreContext): Promise<UploadItemView | null>;
  /** Access checks precede replay, which precedes target/preview freshness.
   * Reserve/bind an absent key durably before returning null. Colliding keys
   * throw; a committed response loss returns the original receipt/status.
   */
  replayCommand(operationId: string, input: UploadCommand, context: UploadCoreContext): Promise<UploadOutcome | null>;
  /** Complete schedules the actual bounded inspector/publication job. Prepare,
   * restore and undo issue previews; only explicit confirm applies their plan.
   * Confirm atomically binds core effects + receipt +
   * lease/target guards. Cancel/retry never invent process/file cleanup proof.
   */
  command(operationId: string, input: UploadCommand, context: UploadCoreContext): Promise<UploadOutcome>;
}
