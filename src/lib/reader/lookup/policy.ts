/** Client policy only; this module performs no I/O. */
export const LOOKUP_LIMITS = {
  concurrentRequests: 3,
  requestTimeoutMs: 4000,
  lookupTimeoutMs: 10000,
  responseBytes: 2 * 1024 * 1024,
  parseResponseBytes: 4 * 1024 * 1024,
  sectionBytes: 20 * 1024,
  cacheEntries: 200,
  cacheBytes: 8 * 1024 * 1024,
  translatorPairs: 8,
} as const;

export const WIKIMEDIA_API_USER_AGENT =
  "Durtal/1.0 (personal e-book reader; https://github.com/pabloagn/durtal)";

export function wikimediaTitle(word: string): string {
  return encodeURIComponent(word.replaceAll(" ", "_"));
}

export function wikimediaUrl(
  wiki: "wiktionary" | "wikipedia",
  language: string,
  path: string,
): string {
  if (
    !/^[a-z]{2,3}$/.test(language) ||
    !path.startsWith("/") ||
    path.startsWith("//")
  )
    throw new Error("Invalid Wikimedia address");
  const base = `https://${language}.${wiki}.org`;
  const url = new URL(path, base);
  if (url.origin !== base || url.username || url.password)
    throw new Error("Invalid Wikimedia address");
  return url.href;
}

export function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim())
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds, 60000)
    : null;
}
