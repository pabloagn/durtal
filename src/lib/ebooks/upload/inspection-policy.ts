import { checkedInteger, checkedSum, UPLOAD_LIMITS } from "./limits";

export function requireArchiveDirectory(bytes: number, entries: number): void {
  checkedInteger(bytes, "central directory bytes", 0, UPLOAD_LIMITS.centralDirectoryBytes);
  checkedInteger(entries, "archive entries", 0, UPLOAD_LIMITS.archiveEntries);
}

/** Charge actual output, including re-reads, before retaining decoded bytes. */
export function chargeDecoded(input: { cumulativeBytes: number; entryBytes: number; nextBytes: number }): {
  cumulativeBytes: number;
  entryBytes: number;
} {
  const entryBytes = checkedSum([input.entryBytes, input.nextBytes], "decoded entry bytes");
  const cumulativeBytes = checkedSum([input.cumulativeBytes, input.nextBytes], "cumulative decoded bytes");
  checkedInteger(entryBytes, "decoded entry bytes", 0, UPLOAD_LIMITS.entryDecodedBytes);
  checkedInteger(cumulativeBytes, "cumulative decoded bytes", 0, UPLOAD_LIMITS.cumulativeDecodedBytes);
  return { entryBytes, cumulativeBytes };
}

export function requireRetainedText(codeUnits: number): void {
  checkedInteger(codeUnits, "retained text", 0, UPLOAD_LIMITS.retainedTextCodeUnits);
}

export function requireImageBudget(input: { width: number; height: number; allocatedNativeBytes: number; requestedNativeBytes: number }): void {
  checkedInteger(input.width, "image width", 1, UPLOAD_LIMITS.imageDimension);
  checkedInteger(input.height, "image height", 1, UPLOAD_LIMITS.imageDimension);
  checkedInteger(input.width * input.height, "image pixels", 1, UPLOAD_LIMITS.imagePixels);
  checkedInteger(checkedSum([input.allocatedNativeBytes, input.requestedNativeBytes], "native image bytes"), "native image bytes", 0, UPLOAD_LIMITS.nativeImageBytes);
}

export interface IsolationEvidence {
  processTreeMemoryLimitBytes: number;
  nodeHeapLimitBytes: number;
  osMemoryLimitVerified: boolean;
  entireProcessTreeBound: boolean;
  ownedIdentityVerified: boolean;
  cpuLimit: number;
  processLimit: number;
}

/** Sampling RSS or setting only V8's heap does not establish a memory boundary. */
export function requireInspectorIsolation(evidence: IsolationEvidence): void {
  if (!evidence.osMemoryLimitVerified || !evidence.entireProcessTreeBound || !evidence.ownedIdentityVerified)
    throw new Error("Inspector OS process-tree limit is not proved");
  checkedInteger(evidence.processTreeMemoryLimitBytes, "process tree memory limit", 1, UPLOAD_LIMITS.processTreeMemoryBytes);
  checkedInteger(evidence.nodeHeapLimitBytes, "V8 heap limit", 1, UPLOAD_LIMITS.v8HeapBytes);
  if (!Number.isFinite(evidence.cpuLimit) || evidence.cpuLimit <= 0 || evidence.cpuLimit > 1) throw new Error("Invalid inspector CPU limit");
  checkedInteger(evidence.processLimit, "inspector process limit", 1, 16);
}

export function deadlineExpired(startedAt: number, now: number, kind: "inspection" | "pdf_text" | "job"): boolean {
  checkedInteger(startedAt, "start time");
  checkedInteger(now, "current time", startedAt);
  const limits = { inspection: UPLOAD_LIMITS.inspectionMs, pdf_text: UPLOAD_LIMITS.pdfTextMs, job: UPLOAD_LIMITS.jobMs };
  if (!Object.hasOwn(limits, kind)) throw new Error("Unknown inspector deadline");
  const ms = limits[kind];
  return now - startedAt >= ms;
}
