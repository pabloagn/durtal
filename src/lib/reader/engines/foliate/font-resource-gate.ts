/** Await the font decision before the original loader can resolve CSS/fonts or return iframe data. */
export function guardFontResourceLoad<T>(
  load: () => Promise<T>,
  prepare: () => void | Promise<void>,
  signal: AbortSignal,
): () => Promise<T> {
  return async () => {
    signal.throwIfAborted();
    await prepare();
    signal.throwIfAborted();
    const result = await load();
    // Retired engines cannot deliver a late resource for attachment.
    signal.throwIfAborted();
    return result;
  };
}
