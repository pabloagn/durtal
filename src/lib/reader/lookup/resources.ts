/** Let native cancel messages and deadline timers run between bounded worker windows. */
export const yieldLookupTasks = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Resource lifetimes shared by acquisition and worker operations. */
export function operationSignal(
  parent: AbortSignal | undefined,
  milliseconds: number,
) {
  const controller = new AbortController();
  const relay = () => controller.abort(parent?.reason);
  if (parent?.aborted) relay();
  else parent?.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("The lookup took too long", "TimeoutError"),
      ),
    milliseconds,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", relay);
    },
  };
}

/** A wait is actually canceled; it never leaves a queued request to run later. */
export class LookupSemaphore {
  private active = 0;
  private waiting: {
    enter: () => void;
    reject: (reason: unknown) => void;
    signal: AbortSignal;
    abort: () => void;
  }[] = [];
  constructor(private readonly maximum: number) {}
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const enter = () => {
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          this.drain();
        });
      };
      if (this.active < this.maximum) enter();
      else {
        if (this.waiting.length >= 64) {
          reject(new Error("Too many lookup requests are waiting"));
          return;
        }
        const item = {
          enter,
          reject,
          signal,
          abort: () => {
            this.waiting = this.waiting.filter(
              (candidate) => candidate !== item,
            );
            reject(signal.reason);
          },
        };
        this.waiting.push(item);
        signal.addEventListener("abort", item.abort, { once: true });
      }
    });
  }
  private drain() {
    while (this.active < this.maximum && this.waiting.length) {
      const item = this.waiting.shift()!;
      item.signal.removeEventListener("abort", item.abort);
      if (item.signal.aborted) item.reject(item.signal.reason);
      else item.enter();
    }
  }
}

/** Race a native read with abort; cancel the underlying stream, including a stalled read. */
export async function consumeLookupStream(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  signal: AbortSignal,
  consume: (bytes: Uint8Array) => void,
): Promise<number> {
  signal.throwIfAborted();
  const reader = stream.getReader();
  let total = 0,
    windows = 0;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const item = await reader.read();
      signal.throwIfAborted();
      if (item.done) return total;
      if (!(item.value instanceof Uint8Array))
        throw new Error("Invalid lookup byte stream");
      total += item.value.byteLength;
      if (total > maximum)
        throw new Error("The lookup data exceeds its size limit");
      consume(item.value);
      if (++windows % 16 === 0) await yieldLookupTasks();
    }
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
