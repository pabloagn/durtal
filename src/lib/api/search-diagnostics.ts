import { AsyncLocalStorage } from "node:async_hooks";

export type SearchProvider = "isbndb" | "google_books" | "open_library";

const failures = new AsyncLocalStorage<Set<SearchProvider>>();

export async function withSearchDiagnostics<T>(run: () => Promise<T>) {
  const providers = new Set<SearchProvider>();
  return failures.run(providers, async () => ({ value: await run(), failedProviders: [...providers] }));
}

/** Never log request URLs, headers, response bodies, or exception messages: they may contain keys. */
export function reportSearchFailure(
  provider: SearchProvider,
  reason: number | "request_failed",
): void {
  // An ISBN absent from a source is a valid empty result.
  if (reason === 404) return;
  failures.getStore()?.add(provider);
  const detail = typeof reason === "number" ? `HTTP ${reason}` : "request failed";
  console.warn(`[book-search] ${provider}: ${detail}`);
}
