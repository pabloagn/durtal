import { forPdfOwner } from "./pdf-lifetime";

/** A successor is recorded only when a render replaces this same live frame. */
export interface PdfFrameRender<T> {
  owner: AbortController;
  result: Promise<T>;
  successor?: PdfFrameRender<T>;
}

export function requireCurrentPdfFrame<T>(
  frame: PdfFrameRender<T>,
  current: () => PdfFrameRender<T> | undefined,
  lifetime: AbortSignal,
  mounted: () => boolean,
) {
  lifetime.throwIfAborted();
  frame.owner.signal.throwIfAborted();
  if (!mounted() || current() !== frame)
    throw new DOMException("PDF frame was retired", "AbortError");
}

/** Keep an initial/open waiter attached to the concrete replacement paint.
 * Only the exact local cancellation reason can hand off; current failures and
 * book/session retirement still reject. A release never records a successor.
 */
export async function followPdfFrameRender<T>(
  first: PdfFrameRender<T>,
  current: () => PdfFrameRender<T> | undefined,
  lifetime: AbortSignal,
  mounted: () => boolean,
): Promise<T> {
  let frame = first;
  for (;;) {
    let value: T;
    try {
      value = await forPdfOwner(frame.result, lifetime);
    } catch (error) {
      lifetime.throwIfAborted();
      if (
        frame.owner.signal.aborted &&
        error === frame.owner.signal.reason &&
        frame.successor && current() && mounted()
      ) {
        frame = frame.successor;
        continue;
      }
      throw error;
    }
    lifetime.throwIfAborted();
    // A replacement can arrive after completion but before this continuation.
    if (frame.owner.signal.aborted && frame.successor && current() && mounted()) {
      frame = frame.successor;
      continue;
    }
    requireCurrentPdfFrame(frame, current, lifetime, mounted);
    return value;
  }
}
