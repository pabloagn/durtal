type SearchProvider = "isbndb" | "google_books" | "open_library";

/** Never log request URLs, headers, response bodies, or exception messages: they may contain keys. */
export function reportSearchFailure(
  provider: SearchProvider,
  reason: number | "request_failed",
): void {
  const detail = typeof reason === "number" ? `HTTP ${reason}` : "request failed";
  console.warn(`[book-search] ${provider}: ${detail}`);
}
