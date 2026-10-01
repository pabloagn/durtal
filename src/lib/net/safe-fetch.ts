import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { isBlockedAddress } from "@/lib/net/ip-policy";
import { isSafeUrl, MAX_MEDIA_SIZE_BYTES } from "@/lib/validations/media-security";

/**
 * Download an image from a user-supplied URL without SSRF, hangs or memory
 * blow-ups. Server only (uses node:http/https).
 *
 * - URL pre-check (scheme, no credentials, no local names or private IP literals).
 * - Every resolved address is checked when the socket connects, so a DNS
 *   answer cannot swap to a private address between check and connect.
 * - Redirects are followed by hand and every hop is checked again.
 * - One deadline for the whole transfer.
 * - Size limit from Content-Length and while streaming (never buffers more).
 * - The bytes must be a JPEG, PNG, GIF or WebP image.
 */

export type SafeFetchErrorCode =
  | "blocked_url"
  | "blocked_address"
  | "bad_status"
  | "too_large"
  | "not_image"
  | "timeout"
  | "too_many_redirects"
  | "network";

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchImageOptions {
  /** Also accept plain http:// (default: https only). */
  allowHttp?: boolean;
  /** Maximum body size in bytes (default: MAX_MEDIA_SIZE_BYTES, 50 MB). */
  maxBytes?: number;
  /** Deadline for the whole transfer, redirects included (default: 30 s). */
  timeoutMs?: number;
  /** Maximum number of redirects to follow (default: 5). */
  maxRedirects?: number;
  /** Address policy; only tests replace it. */
  isBlockedAddress?: (address: string) => boolean;
}

export interface SafeImage {
  buffer: Buffer;
  /** Detected from the bytes, not from the response header. */
  contentType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  finalUrl: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "Mozilla/5.0 (compatible; Durtal/1.0; +https://durtal.app)";
const ACCEPT = "image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1";

/** Identify an image by its magic bytes. */
export function sniffImageType(bytes: Buffer): SafeImage["contentType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** DNS lookup that refuses to hand out any blocked address. */
export function createGuardedLookup(blocked: (address: string) => boolean = isBlockedAddress): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      const cb = callback as (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
      if (err) return cb(err, "");
      const list = addresses as LookupAddress[];
      if (list.length === 0 || list.some((a) => blocked(a.address))) {
        return cb(new SafeFetchError("blocked_address", `${hostname} resolves to an address that is not allowed`) as NodeJS.ErrnoException, "");
      }
      if ((options as { all?: boolean }).all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };
}

interface HopResult {
  redirect?: string;
  image?: SafeImage;
}

function requestOnce(
  url: URL,
  deadline: number,
  maxBytes: number,
  lookup: LookupFunction,
): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new SafeFetchError("timeout", "Image download timed out"));

    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: ACCEPT },
      lookup,
      // Never reuse pooled sockets: every connection goes through the guarded lookup.
      agent: false,
    });
    // Runs asynchronously, after `fail` below is defined.
    const timer = setTimeout(() => {
      const err = new SafeFetchError("timeout", "Image download timed out");
      req.destroy(err);
      fail(err);
    }, remaining);

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const fail = (err: unknown) =>
      settle(() => reject(err instanceof SafeFetchError ? err : new SafeFetchError("network", (err as Error)?.message ?? "Network error")));

    req.on("error", fail);
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;

      if (REDIRECT_STATUSES.has(status)) {
        res.resume();
        const location = res.headers.location;
        if (!location) return fail(new SafeFetchError("bad_status", `Redirect ${status} without a location`));
        return settle(() => resolve({ redirect: location }));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return fail(new SafeFetchError("bad_status", `The server answered ${status}`));
      }

      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        req.destroy();
        return fail(new SafeFetchError("too_large", `Image is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
      }

      const chunks: Buffer[] = [];
      let total = 0;
      let sniffed: SafeImage["contentType"] | null = null;
      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        total += chunk.length;
        if (total > maxBytes) {
          const err = new SafeFetchError("too_large", `Image is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
          req.destroy(err);
          return fail(err);
        }
        chunks.push(chunk);
        // Refuse a non-image as soon as the first bytes arrive
        if (!sniffed && total >= 12) {
          sniffed = sniffImageType(Buffer.concat(chunks));
          if (!sniffed) {
            const err = new SafeFetchError("not_image", "The URL does not point to a JPEG, PNG, GIF or WebP image");
            req.destroy(err);
            return fail(err);
          }
        }
      });
      res.on("error", fail);
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const contentType = sniffed ?? sniffImageType(buffer);
        if (!contentType) return fail(new SafeFetchError("not_image", "The URL does not point to a JPEG, PNG, GIF or WebP image"));
        settle(() => resolve({ image: { buffer, contentType, finalUrl: url.toString() } }));
      });
    });
    req.end();
  });
}

export async function safeFetchImage(url: string, options: SafeFetchImageOptions = {}): Promise<SafeImage> {
  const {
    allowHttp = false,
    maxBytes = MAX_MEDIA_SIZE_BYTES,
    timeoutMs = 30_000,
    maxRedirects = 5,
    isBlockedAddress: blocked = isBlockedAddress,
  } = options;
  const deadline = Date.now() + timeoutMs;
  const lookup = createGuardedLookup(blocked);

  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isSafeUrl(current, { allowHttp, isBlockedAddress: blocked })) {
      throw new SafeFetchError("blocked_url", hop === 0 ? "URL not allowed" : "Redirect to a URL that is not allowed");
    }
    const result = await requestOnce(new URL(current), deadline, maxBytes, lookup);
    if (result.image) return result.image;
    current = new URL(result.redirect!, current).toString();
  }
  throw new SafeFetchError("too_many_redirects", `More than ${maxRedirects} redirects`);
}
