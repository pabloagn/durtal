import "server-only";
import { crossOriginRefusal } from "./same-origin";
import { LOOKUP_LIMITS, WIKIMEDIA_API_USER_AGENT, retryAfterMs } from "@/lib/reader/lookup/policy";
import { consumeLookupStream, LookupSemaphore, operationSignal } from "@/lib/reader/lookup/resources";
import {
  WIKIMEDIA_RELAY_ERROR,
  WIKIMEDIA_REQUEST_BYTES,
  wikimediaAddress,
  wikimediaRequest,
  wikimediaResponseBytes,
} from "@/lib/reader/lookup/wikimedia-protocol";

const headers = { "Cache-Control": "no-store" };
class RelayFailure extends Error {
  constructor(readonly status: number, readonly kind?: "network" | "invalid" | "timeout") {
    super("Wikimedia acquisition refused");
  }
}
const refusal = (status: number, kind?: RelayFailure["kind"], retry?: number) =>
  new Response(null, {
    status,
    headers: {
      ...headers,
      ...(kind ? { [WIKIMEDIA_RELAY_ERROR]: kind } : {}),
      ...(retry !== undefined ? { "Retry-After": String(Math.ceil(retry / 1000)) } : {}),
    },
  });

/** Browser provenance only; the private app's deployment remains its auth boundary. */
function admitted(req: Request): boolean {
  if (crossOriginRefusal(req)) return false;
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site && site !== "same-origin") return false;
  if (!site && !origin) return false;
  if (origin) {
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || origin !== url.origin) return false;
    } catch { return false; }
  }
  // The existing app guard trusts browser Fetch Metadata. A private HTTPS
  // reverse proxy can expose a loopback HTTP req.url; no forwarded header is
  // a configured authority in this app. Only the metadata-free fallback can
  // compare the complete origin to req.url, without inventing proxy trust.
  if (!site && origin !== new URL(req.url).origin) return false;
  return true;
}

function rejectRequest(req: Request, status: number, retry?: number): Response {
  if (req.body && !req.body.locked) void req.body.cancel().catch(() => {});
  return refusal(status, undefined, retry);
}

async function readRequest(req: Request, signal: AbortSignal) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "") ||
      req.headers.has("content-encoding") || !req.body)
    throw new RelayFailure(400);
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > WIKIMEDIA_REQUEST_BYTES))
    throw new RelayFailure(413);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  const lifetime = operationSignal(signal, LOOKUP_LIMITS.requestTimeoutMs);
  try {
    const bytes = await consumeLookupStream(req.body, WIKIMEDIA_REQUEST_BYTES, lifetime.signal,
      (part) => parts.push(decoder.decode(part, { stream: true })));
    if (declared !== null && Number(declared) !== bytes) throw new RelayFailure(400);
    parts.push(decoder.decode());
    const request = wikimediaRequest(JSON.parse(parts.join("")));
    wikimediaAddress(request);
    return request;
  } catch (error) {
    if (lifetime.signal.aborted) throw lifetime.signal.reason;
    if (error instanceof RelayFailure) throw error;
    if (error instanceof Error && error.message === "The lookup data exceeds its size limit")
      throw new RelayFailure(413);
    throw new RelayFailure(400);
  } finally { lifetime.dispose(); }
}

/** Bounds are per process. The only retained data is capacity and host cooldowns. */
export function createWikimediaRelay(request: typeof fetch = (...args) => fetch(...args)) {
  const semaphore = new LookupSemaphore(LOOKUP_LIMITS.concurrentRequests);
  const cooldown = new Map<string, number>();
  let pending = 0;
  return async function relay(req: Request): Promise<Response> {
    if (req.method !== "POST") return rejectRequest(req, 405);
    if (!admitted(req)) return rejectRequest(req, 403);
    // Three active plus the resource semaphore's existing 64-waiter limit.
    if (pending >= LOOKUP_LIMITS.concurrentRequests + 64) return rejectRequest(req, 429, 1000);
    pending++;
    const lifetime = operationSignal(req.signal, LOOKUP_LIMITS.lookupTimeoutMs);
    let release: (() => void) | undefined;
    let upstream: Response | undefined;
    let acquisition: ReturnType<typeof operationSignal> | undefined;
    try {
      release = await semaphore.acquire(lifetime.signal);
      const input = await readRequest(req, lifetime.signal);
      const address = wikimediaAddress(input), host = new URL(address).hostname;
      const until = cooldown.get(host) ?? 0;
      if (until > Date.now()) return refusal(429, undefined, until - Date.now());
      cooldown.delete(host);
      acquisition = operationSignal(lifetime.signal, LOOKUP_LIMITS.requestTimeoutMs);
      try {
        acquisition.signal.throwIfAborted();
        upstream = await request(address, {
          method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
          referrerPolicy: "no-referrer", signal: acquisition.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": WIKIMEDIA_API_USER_AGENT,
            "Api-User-Agent": WIKIMEDIA_API_USER_AGENT,
          },
        });
      } catch (error) {
        if (acquisition.signal.aborted) throw acquisition.signal.reason;
        throw new RelayFailure(502, "network");
      }
      acquisition.signal.throwIfAborted();
      if (upstream.status === 429) {
        const delay = retryAfterMs(upstream.headers.get("Retry-After"), Date.now()) ?? 1000;
        if (cooldown.size >= 64) cooldown.delete(cooldown.keys().next().value!);
        cooldown.set(host, Date.now() + delay);
        return refusal(429, undefined, delay);
      }
      if (!upstream.ok) return refusal(upstream.status);
      const maximum = wikimediaResponseBytes(input);
      const declared = upstream.headers.get("content-length");
      if ((declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) ||
          !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(upstream.headers.get("content-type") ?? "") ||
          !upstream.body)
        throw new RelayFailure(502, "invalid");
      const parts: Uint8Array[] = [], text: string[] = [];
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes: number;
      try {
        bytes = await consumeLookupStream(upstream.body, maximum, acquisition.signal, (part) => {
          parts.push(part.slice());
          text.push(decoder.decode(part, { stream: true }));
        });
        text.push(decoder.decode());
        JSON.parse(text.join(""));
      } catch (error) {
        if (acquisition.signal.aborted) throw acquisition.signal.reason;
        throw new RelayFailure(502, "invalid");
      }
      acquisition.signal.throwIfAborted();
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
      return new Response(body, {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json", "Content-Length": String(bytes) },
      });
    } catch (error) {
      if (req.signal.aborted) return refusal(499);
      if (lifetime.signal.aborted || acquisition?.signal.aborted ||
          (error instanceof DOMException && error.name === "TimeoutError"))
        return refusal(504, "timeout");
      if (error instanceof RelayFailure) return refusal(error.status, error.kind);
      return refusal(502, "network");
    } finally {
      if (upstream?.body && !upstream.body.locked) void upstream.body.cancel().catch(() => {});
      if (req.body && !req.body.locked) void req.body.cancel().catch(() => {});
      acquisition?.dispose(); lifetime.dispose(); release?.(); pending--;
    }
  };
}
