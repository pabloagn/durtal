/** Server-side tracker writes do not pass through the annotation outbox. This
 * handoff asks each mounted annotation owner for a fresh pull after the commit.
 * It changes no cursor/cache/operation and is separate from durable mutations.
 */
type Refresh = () => Promise<void>;
const listeners = new Map<string, Set<Refresh>>();

export function subscribeAnnotationServerChanges(ebookId: string, refresh: Refresh) {
  const book = listeners.get(ebookId) ?? new Set<Refresh>();
  book.add(refresh);
  listeners.set(ebookId, book);
  return () => {
    book.delete(refresh);
    if (!book.size && listeners.get(ebookId) === book) listeners.delete(ebookId);
  };
}

export async function refreshServerAnnotations(ebookId: string) {
  await Promise.all([...(listeners.get(ebookId) ?? [])].map((refresh) => refresh()));
}

/** A refresh failure cannot turn an already committed quote into a failed save. */
export async function saveQuoteWithRefresh<T>(ebookId: string, save: () => Promise<T>,
  failed: (error: unknown) => void) {
  const saved = await save();
  try { await refreshServerAnnotations(ebookId); }
  catch (error) { failed(error); }
  return saved;
}
