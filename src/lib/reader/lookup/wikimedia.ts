import {
  LOOKUP_LIMITS,
  WIKIMEDIA_API_USER_AGENT,
  retryAfterMs,
} from "./policy";
import {
  consumeLookupStream,
  LookupSemaphore,
  operationSignal,
} from "./resources";
import {
  WIKIMEDIA_RELAY_ERROR,
  WIKIMEDIA_RELAY_PATH,
  wikimediaRequestFromAddress,
} from "./wikimedia-protocol";

export { WIKIMEDIA_API_USER_AGENT } from "./policy";

export class WikimediaError extends Error {
  constructor(
    public readonly kind: "http" | "network" | "invalid" | "rate-limit",
    public readonly status = 0,
  ) {
    super(
      kind === "network"
        ? "No connection"
        : kind === "rate-limit"
          ? "Wikimedia is busy. Try again shortly"
          : "Wikimedia could not return this entry",
    );
  }
}

/** Only the three approved Wikimedia endpoints may acquire data. No source templates reach fetch. */
function approvedAddress(value: string): URL {
  wikimediaRequestFromAddress(value);
  return new URL(value);
}

/** App authentication is same-origin; no browser credential reaches Wikimedia. */
const relayRequest: typeof fetch = async (address, options) => {
  const request = wikimediaRequestFromAddress(String(address));
  const response = await fetch(WIKIMEDIA_RELAY_PATH, {
    method: "POST",
    mode: "same-origin",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal: options?.signal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const error = response.headers.get(WIKIMEDIA_RELAY_ERROR);
  if (!response.ok && ["network", "invalid", "timeout"].includes(error ?? "")) {
    void response.body?.cancel().catch(() => {});
    if (error === "timeout") throw new DOMException("The lookup took too long", "TimeoutError");
    throw new WikimediaError(error as "network" | "invalid");
  }
  return response;
};

/** One session client caps both active requests and successful raw JSON cache allocations. */
export class WikimediaClient {
  private readonly semaphore = new LookupSemaphore(
    LOOKUP_LIMITS.concurrentRequests,
  );
  private readonly cooldown = new Map<string, number>();
  private readonly cache = new Map<
    string,
    { json: string; bytes: number; responseBytes: number }
  >();
  private cacheBytes = 0;
  constructor(
    private readonly request: typeof fetch = relayRequest,
  ) {}

  async json(
    address: string,
    signal: AbortSignal,
    maximum: number = LOOKUP_LIMITS.responseBytes,
  ): Promise<unknown> {
    const url = approvedAddress(address);
    if (
      maximum !== LOOKUP_LIMITS.responseBytes &&
      maximum !== LOOKUP_LIMITS.parseResponseBytes
    )
      throw new Error("Invalid Wikimedia response limit");
    signal.throwIfAborted();
    const cached = this.cache.get(address);
    if (cached && cached.responseBytes <= maximum) {
      this.cache.delete(address);
      this.cache.set(address, cached);
      return JSON.parse(cached.json);
    }
    const release = await this.semaphore.acquire(signal);
    const lifetime = operationSignal(signal, LOOKUP_LIMITS.requestTimeoutMs);
    let response: Response | undefined;
    try {
      lifetime.signal.throwIfAborted();
      const until = this.cooldown.get(url.hostname) ?? 0;
      if (until > Date.now()) throw new WikimediaError("rate-limit", 429);
      this.cooldown.delete(url.hostname);
      try {
        response = await this.request(url.href, {
          method: "GET",
          mode: "cors",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: lifetime.signal,
          headers: {
            "Api-User-Agent": WIKIMEDIA_API_USER_AGENT,
            Accept: "application/json",
          },
        });
      } catch (error) {
        if (lifetime.signal.aborted) throw lifetime.signal.reason;
        if (error instanceof DOMException && error.name === "TimeoutError") throw error;
        throw error instanceof WikimediaError
          ? error
          : new WikimediaError("network");
      }
      lifetime.signal.throwIfAborted();
      if (response.status === 429) {
        if (this.cooldown.size >= 64)
          this.cooldown.delete(this.cooldown.keys().next().value!);
        this.cooldown.set(
          url.hostname,
          Date.now() +
            (retryAfterMs(response.headers.get("Retry-After"), Date.now()) ??
              1000),
        );
        throw new WikimediaError("rate-limit", 429);
      }
      if (!response.ok) throw new WikimediaError("http", response.status);
      const size = response.headers.get("Content-Length");
      if (size !== null && (!/^\d+$/.test(size) || Number(size) > maximum))
        throw new WikimediaError("invalid");
      if (
        !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(
          response.headers.get("Content-Type") ?? "",
        )
      )
        throw new WikimediaError("invalid");
      if (!response.body) throw new WikimediaError("invalid");
      const decoder = new TextDecoder("utf-8", { fatal: true }),
        pieces: string[] = [];
      let count: number;
      try {
        count = await consumeLookupStream(
          response.body,
          maximum,
          lifetime.signal,
          (chunk) => pieces.push(decoder.decode(chunk, { stream: true })),
        );
        pieces.push(decoder.decode());
      } catch (error) {
        if (lifetime.signal.aborted) throw lifetime.signal.reason;
        throw error instanceof WikimediaError
          ? error
          : new WikimediaError("invalid");
      }
      const json = pieces.join("");
      let result: unknown;
      try {
        result = JSON.parse(json);
      } catch {
        throw new WikimediaError("invalid");
      }
      // Raw UTF-8 plus worst-case UTF-16. Cached models are reparsed, so caller mutations cannot poison the session.
      const bytes = count + json.length * 2;
      if (bytes <= LOOKUP_LIMITS.cacheBytes) {
        const prior = this.cache.get(address);
        if (prior) {
          this.cacheBytes -= prior.bytes;
          this.cache.delete(address);
        }
        while (
          this.cache.size >= LOOKUP_LIMITS.cacheEntries ||
          this.cacheBytes + bytes > LOOKUP_LIMITS.cacheBytes
        ) {
          const oldest = this.cache.keys().next().value!;
          this.cacheBytes -= this.cache.get(oldest)!.bytes;
          this.cache.delete(oldest);
        }
        this.cache.set(address, { json, bytes, responseBytes: count });
        this.cacheBytes += bytes;
      }
      return result;
    } finally {
      if (response?.body && !response.body.locked)
        void response.body.cancel().catch(() => {});
      lifetime.dispose();
      release();
    }
  }
}

export const wikimedia = new WikimediaClient();
