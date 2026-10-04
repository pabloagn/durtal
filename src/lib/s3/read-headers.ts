/**
 * Headers that keep a stored file from running as a page on the app origin.
 * /api/s3/read sends S3 bytes from the app's own origin: an HTML or SVG
 * object opened directly could otherwise run its script here.
 */

/**
 * Folders whose files the app shows: images, edition covers and comment
 * attachments. Raw uploads, intermediate files and anything else in the
 * bucket are not served.
 */
const READABLE_PREFIXES = ["gold/media/", "gold/covers/", "gold/comments/"];

/** Whether /api/s3/read may serve this key. */
export function isReadableKey(key: string): boolean {
  return (
    READABLE_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
    !key.split("/").some((part) => part === ".." || part === "")
  );
}

/** Raster images: safe to show inline. */
const INLINE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Sent on every response: no type sniffing, and no script, forms or origin. */
export const READ_SAFETY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox",
} as const;

/**
 * Content headers for a stored object. Raster images show inline; any other
 * type (HTML, SVG, PDF, unknown) downloads as an attachment.
 */
export function contentHeaders(contentType: string | undefined): Record<string, string> {
  const type = contentType?.split(";")[0].trim().toLowerCase();
  const inline = !!type && INLINE_TYPES.has(type);
  return {
    ...READ_SAFETY_HEADERS,
    "Content-Type": contentType || "application/octet-stream",
    "Content-Disposition": inline ? "inline" : "attachment",
  };
}
