import { open } from "node:fs/promises";
import { chargeDecoded, requireArchiveDirectory, requireImageBudget, requireRetainedText } from "./inspection-policy";
import { checkedInteger, checkedSum, UPLOAD_LIMITS } from "./limits";

export interface InspectorCgroupValues { memoryMax: string; memorySwapMax: string; pidsMax: string; cpuMax: string }

function numeric(value: string, name: string): number {
  if (!/^(0|[1-9][0-9]*)\n?$/.test(value)) throw new Error(`Unbounded inspector ${name}`);
  return checkedInteger(Number(value.trim()), name);
}

/** Actual cgroup values inside the worker, checked before any untrusted parsing. */
export function requireInspectorCgroup(values: InspectorCgroupValues): void {
  if (numeric(values.memoryMax, "memory") !== UPLOAD_LIMITS.processTreeMemoryBytes
    || numeric(values.memorySwapMax, "swap") !== 0 || numeric(values.pidsMax, "processes") !== 16)
    throw new Error("Inspector process-tree cgroup limits differ");
  const cpu = values.cpuMax.trim().split(" ");
  if (cpu.length !== 2) throw new Error("Invalid inspector CPU cgroup");
  const quota = numeric(cpu[0], "CPU quota");
  const period = numeric(cpu[1], "CPU period");
  if (!quota || !period || quota / period > 1) throw new Error("Inspector CPU cgroup is unbounded");
}

export async function readInspectorCgroup(): Promise<InspectorCgroupValues> {
  const read = async (name: string): Promise<string> => {
    const file = await open(`/sys/fs/cgroup/${name}`, "r");
    try {
      const buffer = Buffer.alloc(256);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead === buffer.length) throw new Error("Inspector cgroup proof exceeds its bound");
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally { await file.close(); }
  };
  return { memoryMax: await read("memory.max"), memorySwapMax: await read("memory.swap.max"),
    pidsMax: await read("pids.max"), cpuMax: await read("cpu.max") };
}

/** Hooks for the shared inspector engine; charges precede allocation/retention. */
export class InspectorAttemptBudget {
  private readonly failure = new AbortController();
  private decoded = 0;
  private entries = new Map<string, number>();
  private retainedText = 0;
  private native = 0;
  private nativeReservations = new Map<symbol, number>();
  private textReservations = new Map<symbol, number>();
  private pdfStarted = false;
  private derived = 0;
  constructor(private readonly onPdfPhase: (phase: "start" | "end") => void = () => {}) {}

  get signal(): AbortSignal { return this.failure.signal; }
  assertHealthy(): void { this.failure.signal.throwIfAborted(); }
  reject(message: string): never { return this.check(() => { throw new Error(message); }); }
  private check<T>(task: () => T): T {
    this.assertHealthy();
    try { return task(); } catch (error) { this.failure.abort(error); throw error; }
  }

  archiveDirectory(bytes: number, entries: number): void { this.check(() => requireArchiveDirectory(bytes, entries)); }
  derivedWrite(bytes: number): void {
    this.check(() => {
      const rounded = Math.ceil(checkedInteger(bytes, "derived object bytes") / UPLOAD_LIMITS.allocationUnitBytes) * UPLOAD_LIMITS.allocationUnitBytes;
      this.derived = checkedInteger(this.derived + rounded, "derived cache allocation", 0, UPLOAD_LIMITS.derivedBytes);
    });
  }

  decodedChunk(entryId: string, bytes: number): void {
    this.check(() => {
      if (!entryId || entryId.length > 1024 || (!this.entries.has(entryId) && this.entries.size >= UPLOAD_LIMITS.archiveEntries)) throw new Error("Invalid decoded entry identity");
      const next = chargeDecoded({ cumulativeBytes: this.decoded, entryBytes: this.entries.get(entryId) ?? 0, nextBytes: bytes });
      this.decoded = next.cumulativeBytes;
      this.entries.set(entryId, next.entryBytes);
    });
  }

  /** Parser copies have no proved early release; avoid one Symbol per glyph/token. */
  retainTextPermanent(codeUnits: number): void {
    this.check(() => {
      const next = checkedSum([this.retainedText, codeUnits], "retained text");
      requireRetainedText(next); this.retainedText = next;
    });
  }

  retainText(codeUnits: number): () => void {
    return this.check(() => {
      checkedInteger(codeUnits, "text allocation");
      const next = checkedSum([this.retainedText, codeUnits], "retained text");
      requireRetainedText(next);
      const id = Symbol();
      this.textReservations.set(id, codeUnits);
      this.retainedText = next;
      return () => { const size = this.textReservations.get(id); if (size !== undefined) { this.retainedText -= size; this.textReservations.delete(id); } };
    });
  }

  imageAllocation(width: number, height: number, requestedNativeBytes: number): () => void {
    return this.check(() => {
      requireImageBudget({ width, height, allocatedNativeBytes: this.native, requestedNativeBytes });
      const id = Symbol();
      this.nativeReservations.set(id, requestedNativeBytes);
      this.native += requestedNativeBytes;
      return () => { const bytes = this.nativeReservations.get(id); if (bytes !== undefined) { this.native -= bytes; this.nativeReservations.delete(id); } };
    });
  }

  snapshot(): { decodedBytes: number; retainedTextCodeUnits: number; nativeBytes: number } {
    return { decodedBytes: this.decoded, retainedTextCodeUnits: this.retainedText, nativeBytes: this.native };
  }

  /** The host still enforces the wall deadline if the worker event loop blocks. */
  async pdfText<T>(task: (signal: AbortSignal) => Promise<T>, parent: AbortSignal): Promise<T> {
    parent.throwIfAborted();
    this.check(() => {
      if (this.pdfStarted) throw new Error("Inspector PDF extraction already started");
      this.pdfStarted = true;
      this.onPdfPhase("start");
    });
    const timeout = AbortSignal.timeout(UPLOAD_LIMITS.pdfTextMs);
    const signal = AbortSignal.any([parent, timeout, this.signal]);
    return new Promise<T>((resolve, reject) => {
      const expired = () => { this.failure.abort(signal.reason); reject(signal.reason); };
      signal.addEventListener("abort", expired, { once: true });
      Promise.resolve().then(() => { signal.throwIfAborted(); return task(signal); }).then((result) => {
        signal.removeEventListener("abort", expired);
        signal.throwIfAborted();
        this.onPdfPhase("end");
        resolve(result);
      }).catch((error) => {
        signal.removeEventListener("abort", expired);
        this.failure.abort(error);
        reject(error);
      });
    });
  }
}
