export function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

/** Never retain a section while waiting for a cancelled task or acquisition. */
export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", cancel, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}

/** A real task boundary: microtasks do not let input, rendering or cancellation run. */
export async function yieldReaderTask(signal: AbortSignal) {
  checkAbort(signal);
  const scheduler = (
    globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }
  ).scheduler;
  if (scheduler?.yield) await abortable(scheduler.yield(), signal);
  else
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const finish = (error?: DOMException) => {
        channel.port1.close();
        channel.port2.close();
        signal.removeEventListener("abort", cancel);
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => finish(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", cancel, { once: true });
      channel.port1.onmessage = () => finish();
      channel.port2.postMessage(null);
    });
  checkAbort(signal);
}
