/*
 * HTTP byte ranges for the app's own file route (SLN-491), as S3 answers
 * them: one range (of several, the first), "bytes=a-b", "bytes=a-" or the
 * suffix "bytes=-n". A header that is not a valid byte range is ignored and
 * the whole file is sent (RFC 9110, 14.2).
 */

export type ByteRange =
  | { kind: "whole" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

export function parseRange(header: string | null, size: number): ByteRange {
  if (!header) return { kind: "whole" };
  const match = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*(?:,|$)/i.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return { kind: "whole" };
  const [, first, last] = match;
  if (first === "") {
    // The last n bytes
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix)) return { kind: "whole" };
    if (suffix === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? Infinity : Number(last);
  if (!Number.isSafeInteger(start) || (last !== "" && (!Number.isSafeInteger(end) || end < start))) return { kind: "whole" };
  if (start >= size) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}

/** Whether If-None-Match names this ETag (or is "*") */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((tag) => {
    const value = tag.trim();
    return value === "*" || value === etag || value === `W/${etag}`;
  });
}
