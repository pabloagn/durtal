/** Abort delivery to one owner while leaving the shared producer running. */
export function forPdfOwner<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(
      signal.reason ?? new DOMException("Cancelled", "AbortError"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (!signal.aborted) resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        if (!signal.aborted) reject(error);
      },
    );
  });
}
