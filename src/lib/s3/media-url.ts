/**
 * Browser URLs for S3 images served by /api/s3/read.
 * Client-safe: no server imports.
 */

/** Widths the image route resizes to. Any other `w` is rejected. */
export const MEDIA_WIDTHS = [240, 400, 800] as const;
export type MediaWidth = (typeof MEDIA_WIDTHS)[number];

export function isMediaWidth(w: number): w is MediaWidth {
  return (MEDIA_WIDTHS as readonly number[]).includes(w);
}

/**
 * URL for an S3 key. Pass `version` (for example the row's `updatedAt`)
 * when the bytes at the key can change: the route then caches the
 * response as immutable, and a new version gives a new URL.
 */
export function mediaUrl(
  key: string,
  opts: { version?: string | number | Date | null; width?: MediaWidth } = {},
): string {
  const params = new URLSearchParams({ key });
  if (opts.version != null) {
    const v = opts.version instanceof Date ? opts.version.getTime() : opts.version;
    params.set("v", String(v));
  }
  if (opts.width) params.set("w", String(opts.width));
  return `/api/s3/read?${params}`;
}

/** The same image URL at a resized width. */
export function withMediaWidth(url: string, width: MediaWidth): string {
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("w", String(width));
  return `${path}?${params}`;
}
