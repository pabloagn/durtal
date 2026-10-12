import { checkedInteger, UPLOAD_LIMITS } from "./limits";
import { validateFence, type OperationFence } from "./lifecycle";

export class UploadQuiescingError extends Error {
  constructor() { super("Upload I/O is quiescing"); }
}

/** One owned spool writer process. Cross-process ownership is fenced by persistence. */
export class UploadIoGate {
  private accepting = false;
  private fence: OperationFence | null = null;
  private active = new Set<AbortController>();
  private drains = new Set<() => void>();
  private streams = 0;
  private barriers = 0;

  open(fence: OperationFence): void {
    validateFence(fence);
    if (this.active.size || this.streams || this.barriers || this.accepting) throw new Error("I/O gate is not quiescent");
    this.fence = { ...fence };
    this.accepting = true;
  }

  snapshot(): { accepting: boolean; activeWriters: number; streamsClosed: boolean; pendingIoSettled: boolean } {
    return { accepting: this.accepting, activeWriters: this.active.size,
      streamsClosed: this.streams === 0, pendingIoSettled: this.active.size === 0 && this.barriers === 0 };
  }

  quiesce(reason: unknown = new UploadQuiescingError()): void {
    this.accepting = false;
    for (const controller of this.active) controller.abort(reason);
  }

  /** The promise includes stream cancellation/handle close, not just abort delivery. */
  async writer<T>(fence: OperationFence, task: (signal: AbortSignal, trackStream: () => () => void) => Promise<T>): Promise<T> {
    validateFence(fence);
    if (!this.accepting || this.barriers || !this.fence || this.fence.ownerToken !== fence.ownerToken
      || this.fence.ownerFence !== fence.ownerFence) throw new UploadQuiescingError();
    if (this.active.size >= UPLOAD_LIMITS.serverPartConcurrency) throw new Error("Upload writer slots exhausted");
    const controller = new AbortController();
    this.active.add(controller);
    let localStreams = 0;
    try {
      return await task(controller.signal, () => {
        this.streams++;
        localStreams++;
        let closed = false;
        return () => { if (!closed) { closed = true; this.streams--; localStreams--; this.notifyDrain(); } };
      });
    } finally {
      this.active.delete(controller);
      // Missing stream settlement holds the gate closed; never invent cleanup proof.
      if (localStreams) this.quiesce(new Error("Writer returned with an unsettled stream"));
      this.notifyDrain();
    }
  }

  /** Admission/inventory must sample with all owned writers excluded. */
  async barrier<T>(task: () => Promise<T>): Promise<T> {
    if (this.barriers) throw new Error("Upload allocation barrier already held");
    this.barriers++;
    try {
      await this.drain(UPLOAD_LIMITS.cleanupMs);
      return await task();
    } finally { this.barriers--; this.notifyDrain(); }
  }

  async drain(timeoutMs = UPLOAD_LIMITS.cleanupMs): Promise<void> {
    checkedInteger(timeoutMs, "I/O drain timeout", 1, UPLOAD_LIMITS.cleanupMs);
    if (!this.active.size && !this.streams) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); this.drains.delete(done); resolve(); };
      const timer = setTimeout(() => { this.drains.delete(done); reject(new Error("Upload I/O did not settle; resources remain held")); }, timeoutMs);
      this.drains.add(done);
      this.notifyDrain();
    });
  }

  private notifyDrain(): void {
    if (!this.active.size && !this.streams) for (const done of this.drains) done();
  }
}
