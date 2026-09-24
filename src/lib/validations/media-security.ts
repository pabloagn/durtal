/** Allowed image MIME types for media uploads */
export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Maximum file size in bytes (50 MB) */
export const MAX_MEDIA_SIZE_BYTES = 50 * 1024 * 1024;

/** Validate a MIME/content type is an allowed image type */
export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(contentType.toLowerCase().split(";")[0].trim());
}

/** Validate a URL is safe to fetch (no SSRF) */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow HTTPS
    if (parsed.protocol !== "https:") return false;
    // Block localhost and private IPs
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "[::1]" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
