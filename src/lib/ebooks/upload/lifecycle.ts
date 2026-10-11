import { checkedInteger, UPLOAD_LIMITS } from "./limits";

export interface OperationFence {
  operationId: string;
  ownerToken: string;
  ownerFence: number;
  generation: number;
}

export function validateFence(fence: OperationFence): void {
  for (const value of [fence.operationId, fence.ownerToken]) {
    if (!value || value.length > 128 || value.trim() !== value) throw new Error("Invalid operation fence identity");
  }
  checkedInteger(fence.ownerFence, "owner fence");
  checkedInteger(fence.generation, "operation generation");
}

export function sameFence(expected: OperationFence, current: OperationFence): boolean {
  validateFence(expected);
  validateFence(current);
  return expected.operationId === current.operationId
    && expected.ownerToken === current.ownerToken
    && expected.ownerFence === current.ownerFence
    && expected.generation === current.generation;
}

/** A stale/expired worker may finish immutable I/O, but cannot commit an effect. */
export function mayCommitEffect(input: {
  expected: OperationFence;
  current: OperationFence;
  now: number;
  leaseExpiresAt: number;
  quiescing: boolean;
}): boolean {
  checkedInteger(input.now, "current time");
  checkedInteger(input.leaseExpiresAt, "lease expiry");
  return !input.quiescing && input.now < input.leaseExpiresAt && sameFence(input.expected, input.current);
}

export interface CleanupEvidence {
  fence: OperationFence;
  inspector: "never_started" | "exit_confirmed" | "running" | "unknown";
  activeWriters: number;
  streamsClosed: boolean;
  pendingIoSettled: boolean;
  scratchRemoved: boolean;
  allocatedFilesVerified: boolean;
  proofPersisted: boolean;
  transportRemoved: boolean;
  derivedCacheRemoved: boolean;
}

/** Lease expiry deliberately is not cleanup evidence. */
export function releaseEligibility(current: OperationFence, evidence: CleanupEvidence): {
  worker: boolean;
  reservation: boolean;
} {
  checkedInteger(evidence.activeWriters, "active writers", 0, UPLOAD_LIMITS.serverPartConcurrency);
  const worker = sameFence(current, evidence.fence)
    && (evidence.inspector === "never_started" || evidence.inspector === "exit_confirmed")
    && evidence.activeWriters === 0
    && evidence.streamsClosed
    && evidence.pendingIoSettled
    && evidence.scratchRemoved
    && evidence.allocatedFilesVerified
    && evidence.proofPersisted;
  return { worker, reservation: worker && evidence.transportRemoved && evidence.derivedCacheRemoved };
}

export interface TerminationProgress {
  fenced: boolean;
  abortRequested: boolean;
  inspector: CleanupEvidence["inspector"];
  terminationRequestedAt: number | null;
  forcedTerminationRequested: boolean;
  streamsClosed: boolean;
  pendingIoSettled: boolean;
  scratchRemoved: boolean;
  allocatedFilesVerified: boolean;
  proofPersisted: boolean;
}

/** Pure ordering policy. The eventual supervisor must prove each transition. */
export function nextTerminationStep(progress: TerminationProgress, now: number):
  "fence" | "abort_io" | "terminate" | "force_terminate" | "wait_for_exit"
  | "wait_for_io" | "remove_scratch" | "verify_files" | "persist_proof" | "quiescent" {
  checkedInteger(now, "current time");
  if (!progress.fenced) return "fence";
  if (!progress.abortRequested) return "abort_io";
  if (progress.inspector === "unknown" || progress.inspector === "running") {
    if (progress.terminationRequestedAt === null) return "terminate";
    checkedInteger(progress.terminationRequestedAt, "termination time", 0, now);
    if (!progress.forcedTerminationRequested && now - progress.terminationRequestedAt >= UPLOAD_LIMITS.terminationGraceMs)
      return "force_terminate";
    return "wait_for_exit";
  }
  if (!progress.streamsClosed || !progress.pendingIoSettled) return "wait_for_io";
  if (!progress.scratchRemoved) return "remove_scratch";
  if (!progress.allocatedFilesVerified) return "verify_files";
  if (!progress.proofPersisted) return "persist_proof";
  return "quiescent";
}

/** Disk pressure can come from unrelated Mac filesystem writes. Never publish success. */
export function diskPressure(errorCode: string | undefined, availableBytes: number): boolean {
  checkedInteger(availableBytes, "available bytes");
  return errorCode === "ENOSPC" || errorCode === "EDQUOT" || availableBytes < UPLOAD_LIMITS.freeReserveBytes;
}
