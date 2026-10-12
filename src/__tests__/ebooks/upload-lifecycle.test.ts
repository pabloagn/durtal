import { describe, expect, it } from "vitest";
import { diskPressure, mayCommitEffect, nextTerminationStep, releaseEligibility, type CleanupEvidence, type OperationFence, type TerminationProgress } from "@/lib/ebooks/upload/lifecycle";
import { chargeDecoded, deadlineExpired, requireArchiveDirectory, requireImageBudget, requireInspectorIsolation, requireRetainedText, type IsolationEvidence } from "@/lib/ebooks/upload/inspection-policy";
import { GiB, MiB, UPLOAD_LIMITS } from "@/lib/ebooks/upload/limits";

const fence: OperationFence = { operationId: "one", ownerToken: "owner", ownerFence: 7, generation: 2 };
const evidence = (): CleanupEvidence => ({ fence, inspector: "exit_confirmed", activeWriters: 0,
  streamsClosed: true, pendingIoSettled: true, scratchRemoved: true, allocatedFilesVerified: true,
  proofPersisted: true, transportRemoved: true, derivedCacheRemoved: true });
const progress = (): TerminationProgress => ({ fenced: false, abortRequested: false, inspector: "running",
  terminationRequestedAt: null, forcedTerminationRequested: false, streamsClosed: false,
  pendingIoSettled: false, scratchRemoved: false, allocatedFilesVerified: false, proofPersisted: false });

describe("fencing and termination policy", () => {
  it("rejects stale generations, supervisors, expired leases and quiescing effects", () => {
    const input = { expected: fence, current: fence, now: 100, leaseExpiresAt: 101, quiescing: false };
    expect(mayCommitEffect(input)).toBe(true);
    expect(mayCommitEffect({ ...input, now: 101 })).toBe(false);
    expect(mayCommitEffect({ ...input, quiescing: true })).toBe(false);
    for (const current of [{ ...fence, generation: 3 }, { ...fence, ownerFence: 8 }, { ...fence, ownerToken: "other" }, { ...fence, operationId: "other" }])
      expect(mayCommitEffect({ ...input, current })).toBe(false);
  });
  it("orders fencing, abort, forced termination, stream settlement and verified cleanup", () => {
    const p = progress();
    expect(nextTerminationStep(p, 100)).toBe("fence");
    p.fenced = true;
    expect(nextTerminationStep(p, 100)).toBe("abort_io");
    p.abortRequested = true;
    expect(nextTerminationStep(p, 100)).toBe("terminate");
    p.terminationRequestedAt = 100;
    expect(nextTerminationStep(p, 5099)).toBe("wait_for_exit");
    expect(nextTerminationStep(p, 5100)).toBe("force_terminate");
    p.forcedTerminationRequested = true;
    expect(nextTerminationStep(p, 10_000)).toBe("wait_for_exit");
    p.inspector = "exit_confirmed";
    expect(nextTerminationStep(p, 10_000)).toBe("wait_for_io");
    p.streamsClosed = p.pendingIoSettled = true;
    expect(nextTerminationStep(p, 10_000)).toBe("remove_scratch");
    p.scratchRemoved = true;
    expect(nextTerminationStep(p, 10_000)).toBe("verify_files");
    p.allocatedFilesVerified = true;
    expect(nextTerminationStep(p, 10_000)).toBe("persist_proof");
    p.proofPersisted = true;
    expect(nextTerminationStep(p, 10_000)).toBe("quiescent");
  });
  it("can release the worker while keeping a resumable transport reservation", () => {
    expect(releaseEligibility(fence, { ...evidence(), transportRemoved: false })).toEqual({ worker: true, reservation: false });
    expect(releaseEligibility(fence, { ...evidence(), inspector: "unknown" })).toEqual({ worker: false, reservation: false });
    expect(releaseEligibility({ ...fence, generation: 3 }, evidence())).toEqual({ worker: false, reservation: false });
  });
  it("quiesces on unrelated external disk pressure or filesystem quota exhaustion", () => {
    expect(diskPressure("ENOSPC", 10 * GiB)).toBe(true);
    expect(diskPressure("EDQUOT", 10 * GiB)).toBe(true);
    expect(diskPressure(undefined, 8 * GiB - 1)).toBe(true);
    expect(diskPressure("EIO", 8 * GiB)).toBe(false);
  });
});

describe("bounded inspector policy", () => {
  it("bounds directories before listing an archive", () => {
    requireArchiveDirectory(8 * MiB, 10_000);
    expect(() => requireArchiveDirectory(8 * MiB + 1, 10_000)).toThrow("directory bytes");
    expect(() => requireArchiveDirectory(1, 10_001)).toThrow("archive entries");
  });
  it("charges real repeated decoding against entry and whole-attempt ceilings", () => {
    expect(chargeDecoded({ cumulativeBytes: 250 * MiB, entryBytes: 0, nextBytes: 6 * MiB })).toEqual({ cumulativeBytes: 256 * MiB, entryBytes: 6 * MiB });
    expect(() => chargeDecoded({ cumulativeBytes: 256 * MiB, entryBytes: 0, nextBytes: 1 })).toThrow("cumulative decoded bytes");
    expect(() => chargeDecoded({ cumulativeBytes: 64 * MiB, entryBytes: 64 * MiB, nextBytes: 1 })).toThrow("decoded entry bytes");
    expect(() => requireRetainedText(UPLOAD_LIMITS.retainedTextCodeUnits + 1)).toThrow("retained text");
  });
  it("bounds dimensions, pixels and concurrent native buffers before decode", () => {
    requireImageBudget({ width: 4096, height: 4096, allocatedNativeBytes: 64 * MiB, requestedNativeBytes: 64 * MiB });
    expect(() => requireImageBudget({ width: 4096, height: 4097, allocatedNativeBytes: 0, requestedNativeBytes: 0 })).toThrow("image pixels");
    expect(() => requireImageBudget({ width: 16_385, height: 1, allocatedNativeBytes: 0, requestedNativeBytes: 0 })).toThrow("image width");
    expect(() => requireImageBudget({ width: 1, height: 1, allocatedNativeBytes: 128 * MiB, requestedNativeBytes: 1 })).toThrow("native image bytes");
  });
  it("requires an owned OS limit for the entire process tree, not RSS samples", () => {
    const valid: IsolationEvidence = { processTreeMemoryLimitBytes: 768 * MiB, nodeHeapLimitBytes: 256 * MiB,
      osMemoryLimitVerified: true, entireProcessTreeBound: true, ownedIdentityVerified: true, cpuLimit: 1, processLimit: 16 };
    requireInspectorIsolation(valid);
    for (const change of [{ osMemoryLimitVerified: false }, { entireProcessTreeBound: false }, { ownedIdentityVerified: false },
      { processTreeMemoryLimitBytes: 768 * MiB + 1 }, { nodeHeapLimitBytes: 256 * MiB + 1 }, { cpuLimit: 2 }, { processLimit: 17 }])
      expect(() => requireInspectorIsolation({ ...valid, ...change })).toThrow();
  });
  it.each(["inspection", "pdf_text", "job"] as const)("expires %s at its hard wall-time boundary", (kind) => {
    const limit = { inspection: 120_000, pdf_text: 60_000, job: 1_800_000 }[kind];
    expect(deadlineExpired(100, 100 + limit - 1, kind)).toBe(false);
    expect(deadlineExpired(100, 100 + limit, kind)).toBe(true);
    for (const unknown of ["unknown", "__proto__", "toString"])
      expect(() => deadlineExpired(100, 100, unknown as "inspection")).toThrow("Unknown inspector deadline");
  });
});
