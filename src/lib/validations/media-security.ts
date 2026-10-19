import { isBlockedAddress, isIpLiteral } from "@/lib/net/ip-policy";

/** Allowed image MIME types for media uploads, with the extension a raw upload is stored under */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
export const ALLOWED_IMAGE_TYPES = new Set(Object.keys(IMAGE_EXTENSIONS));

/** Maximum file size in bytes (50 MB) */
export const MAX_MEDIA_SIZE_BYTES = 50 * 1024 * 1024;

/** What a file picker offers: only the types an upload accepts */
export const IMAGE_ACCEPT = [...ALLOWED_IMAGE_TYPES].join(",");

/**
 * Why an image file cannot be uploaded, or null when it can. Checked in the
 * browser before sending (SLN-903) and again by the routes.
 */
export function imageFileRefusal(file: { size: number; type: string }): string | null {
  if (file.size > MAX_MEDIA_SIZE_BYTES) return "File too large. Maximum size: 50 MB.";
  if (!isAllowedImageType(file.type)) return "File type not allowed. Accepted: JPEG, PNG, WebP, GIF.";
  return null;
}

/** Validate a MIME/content type is an allowed image type */
export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(contentType.toLowerCase().split(";")[0].trim());
}

/** Host names that only exist on local networks (never fetched server-side). */
const LOCAL_NAME_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".ts.net"];

export interface SafeUrlOptions {
  /** Also accept plain http:// (default: https only). */
  allowHttp?: boolean;
  /** Address policy for IP literals; tests may replace it. */
  isBlockedAddress?: (address: string) => boolean;
}

/**
 * First-line SSRF check on the URL string: scheme, no credentials, no local
 * host names, no private or reserved IP literals. The URL parser normalizes
 * decimal, hex and octal IPv4 forms, so "https://2130706433" is 127.0.0.1.
 * Host names are checked again at connect time (see `safeFetchImage`).
 */
export function isSafeUrl(url: string, options: SafeUrlOptions = {}): boolean {
  const { allowHttp = false, isBlockedAddress: blocked = isBlockedAddress } = options;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) return false;
  if (parsed.username || parsed.password) return false;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  if (isIpLiteral(host)) return !blocked(host.replace(/^\[|\]$/g, ""));
  if (host === "localhost" || !host.includes(".")) return false;
  if (LOCAL_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  return true;
}
