import type { UploadCoreAdapter, UploadCoreContext } from "./core-contract";
import type { InspectorIdentity } from "./runtime-contract";
import type { PreparedFile } from "../ingest/prepare";
import type { stageFile } from "../medallion";
import type { UploadSupervisor } from "./supervisor";

export interface UploadPublishedInspection {
  readonly identity: InspectorIdentity;
  readonly name: string;
  readonly prepared: PreparedFile;
  readonly metadata: Record<string, unknown>;
  readonly publication: ReturnType<typeof stageFile>;
}

/** Required 496 integration seam, pending its actual reviewed implementation.
 * Neither method is a transport writer's substitute for the trusted core.
 * current checks permanent completion/cancel/retry scope plus this worker lease.
 * settle returns only after an atomic durable inspection/publication receipt;
 * it preserves the active lease until the supervisor persists cleanup proof.
 * Catalogue changes still require the user's preview/confirm and 495's distinct
 * core-issued upload extension. No fake/default implementation is supplied.
 * After cleanup proof, preview/confirm may use the settled ready operation with
 * null worker leases. Retained originals and reservation are still charged;
 * settled is never a synonym for reservation released. These two job methods
 * must not be reused as running-worker guards for arbitrary preview dwell.
 */
export interface UploadJobCoreAdapter extends UploadCoreAdapter {
  readonly targetFingerprint: string;
  /** Actual496 one-time binding; the broker and dispatcher share this owner. */
  bindSupervisor(supervisor: UploadSupervisor): void;
  assertInspectionCurrent(identity: InspectorIdentity, context: UploadCoreContext): Promise<void>;
  settleInspection(input: UploadPublishedInspection, context: UploadCoreContext): Promise<void>;
}
