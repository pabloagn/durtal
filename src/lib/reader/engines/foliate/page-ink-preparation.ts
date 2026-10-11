import type { PublisherInk } from "./publisher-ink";

/** Runs inside the renderer's existing hidden-but-laid-out document load. */
export async function preparePageInk(
  ink: PublisherInk,
  doc: Document,
  signal: AbortSignal,
  applyCurrentPolicy: () => void,
): Promise<void> {
  signal.throwIfAborted();
  await ink.captureOriginal(doc, signal);
  signal.throwIfAborted();
  applyCurrentPolicy();
  await ink.ready(doc, signal);
  signal.throwIfAborted();
}
