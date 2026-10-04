/**
 * Headers that keep a stored file from running as a page on the app origin.
 * /api/s3/read sends S3 bytes from the app's own origin: an HTML or SVG
 * object opened directly could otherwise run its script here.
 */

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
