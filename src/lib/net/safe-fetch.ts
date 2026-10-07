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

/** One answer of the guarded loop: the final hop, never a redirect */
export interface GuardedAnswer {
  url: URL;
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Null when `readBody` declined to read it */
  body: Buffer | null;
}

export type HopResult = { redirect: string } | { answer: GuardedAnswer };

export interface GuardedFetchOptions {
  allowHttp: boolean;
  isBlockedAddress: (address: string) => boolean;
  timeoutMs: number;
  maxRedirects: number;
  maxBytes: number;
  headers: Record<string, string>;
  /** What is downloaded ("Image", "Page"), for the messages */
  noun: string;
  /** Whether to read an answer's body, from its status and headers */
  readBody: (status: number, headers: http.IncomingHttpHeaders) => boolean;
  /** Checks the bytes read so far; an error it returns stops the transfer */
  onChunk?: (chunks: Buffer[], total: number) => Error | null;
  /** Runs before each hop, once the URL passed its check (the page fetcher checks its registry and robots.txt here) */
  beforeHop?: (url: URL) => Promise<void>;
  /** Sends one hop (the page fetcher paces and retries here); the default sends it once */
  sendHop?: (url: URL, send: () => Promise<HopResult>) => Promise<HopResult>;
}

function requestOnce(url: URL, deadline: number, lookup: LookupFunction, o: GuardedFetchOptions): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new SafeFetchError("timeout", `${o.noun} download timed out`));
    const tooLarge = () => new SafeFetchError("too_large", `${o.noun} is larger than ${Math.round(o.maxBytes / 1024 / 1024)} MB`);

    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, {
      method: "GET",
      headers: o.headers,
      lookup,
      // Never reuse pooled sockets: every connection goes through the guarded lookup.
      agent: false,
    });
    // Runs asynchronously, after `fail` below is defined.
    const timer = setTimeout(() => {
      const err = new SafeFetchError("timeout", `${o.noun} download timed out`);
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
      if (!o.readBody(status, res.headers)) {
        res.resume();
        return settle(() => resolve({ answer: { url, status, headers: res.headers, body: null } }));
      }

      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > o.maxBytes) {
        req.destroy();
        return fail(tooLarge());
      }

      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        total += chunk.length;
        if (total > o.maxBytes) {
          const err = tooLarge();
          req.destroy(err);
          return fail(err);
        }
        chunks.push(chunk);
        const refused = o.onChunk?.(chunks, total);
        if (refused) {
          req.destroy(refused);
          return fail(refused);
        }
      });
      res.on("error", fail);
      res.on("end", () => settle(() => resolve({ answer: { url, status, headers: res.headers, body: Buffer.concat(chunks) } })));
    });
    req.end();
  });
}

/**
 * The guarded request loop of every download from an outside URL: the URL
 * check, the guarded lookup, redirects followed by hand with each hop checked
 * again, one deadline for the whole transfer and a size cap while streaming.
 */
export async function guardedFetch(url: string, o: GuardedFetchOptions): Promise<GuardedAnswer> {
  // The deadline counts time on the network only: a wait between two requests is not transfer
  let budget = o.timeoutMs;
  const lookup = createGuardedLookup(o.isBlockedAddress);
  const send = o.sendHop ?? ((_url, sendOnce) => sendOnce());

  let current = url;
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    if (!isSafeUrl(current, { allowHttp: o.allowHttp, isBlockedAddress: o.isBlockedAddress })) {
      throw new SafeFetchError("blocked_url", hop === 0 ? "URL not allowed" : "Redirect to a URL that is not allowed");
    }
    const target = new URL(current);
    await o.beforeHop?.(target);
    const result = await send(target, async () => {
      const start = Date.now();
      try {
        return await requestOnce(target, start + budget, lookup, o);
      } finally {
        budget -= Date.now() - start;
      }
    });
    if ("answer" in result) return result.answer;
    current = new URL(result.redirect, current).toString();
  }
  throw new SafeFetchError("too_many_redirects", `More than ${o.maxRedirects} redirects`);
}

export async function safeFetchImage(url: string, options: SafeFetchImageOptions = {}): Promise<SafeImage> {
  const {
    allowHttp = false,
    maxBytes = MAX_MEDIA_SIZE_BYTES,
    timeoutMs = 30_000,
    maxRedirects = 5,
    isBlockedAddress: blocked = isBlockedAddress,
  } = options;
  let sniffed: SafeImage["contentType"] | null = null;
  const answer = await guardedFetch(url, {
    allowHttp,
    isBlockedAddress: blocked,
    timeoutMs,
    maxRedirects,
    maxBytes,
    headers: { "User-Agent": USER_AGENT, Accept: ACCEPT },
    noun: "Image",
    readBody: (status) => status >= 200 && status < 300,
    // Refuse a non-image as soon as the first bytes arrive
    onChunk: (chunks, total) => {
      if (sniffed || total < 12) return null;
      sniffed = sniffImageType(Buffer.concat(chunks));
      return sniffed ? null : new SafeFetchError("not_image", "The URL does not point to a JPEG, PNG, GIF or WebP image");
    },
  });
  if (!answer.body) throw new SafeFetchError("bad_status", `The server answered ${answer.status}`);
  const contentType = sniffed ?? sniffImageType(answer.body);
  if (!contentType) throw new SafeFetchError("not_image", "The URL does not point to a JPEG, PNG, GIF or WebP image");
  return { buffer: answer.body, contentType, finalUrl: answer.url.toString() };
}
