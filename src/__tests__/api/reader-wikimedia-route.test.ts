import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createWikimediaRelay } from "@/lib/api/reader-wikimedia";
import { POST, dynamic, runtime } from "@/app/api/reader/lookup/wikimedia/route";
import { LOOKUP_LIMITS, WIKIMEDIA_API_USER_AGENT } from "@/lib/reader/lookup/policy";
import { WIKIMEDIA_RELAY_ERROR, WIKIMEDIA_REQUEST_BYTES, wikimediaAddress } from "@/lib/reader/lookup/wikimedia-protocol";

const endpoint = "http://localhost:3110/api/reader/lookup/wikimedia";
const input = { operation: "definition", language: "en", title: "book" } as const;
const validBody = JSON.stringify(input);
const json = (text = "{}", headers: Record<string, string> = {}) =>
  new Response(text, { headers: { "Content-Type": "application/json", ...headers } });
function request(body: BodyInit = validBody, headers: Record<string, string> = {}, options: RequestInit = {}) {
  return new Request(endpoint, {
    method: "POST", body,
    ...options,
    headers: { host: "localhost:3110", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}
const rawStream = (bytes: Uint8Array, cancel = vi.fn()) => new ReadableStream<Uint8Array>({
  start(stream) { stream.enqueue(bytes); stream.close(); }, cancel,
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("reader Wikimedia route admission", () => {
  it("exports a dynamic Node POST and forwards through the route singleton", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json());
    vi.stubGlobal("fetch", fetch);
    expect(runtime).toBe("nodejs"); expect(dynamic).toBe("force-dynamic");
    expect((await POST(request())).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["cross-site", "same-site", "none"])("refuses %s browser provenance before upstream work", async (site) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const response = await createWikimediaRelay(fetch)(request(validBody, { "sec-fetch-site": site }));
    expect(response.status).toBe(403); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["null", "garbage", "javascript:alert(1)", "https://user@private.example", "https://private.example/path"])("refuses invalid Origin %s", async (origin) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect((await createWikimediaRelay(fetch)(request(validBody, { origin }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps direct HTTP and private HTTPS-to-loopback browser metadata admission", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json()), relay = createWikimediaRelay(fetch);
    expect((await relay(request(validBody, { origin: "http://localhost:3110" }))).status).toBe(200);
    expect((await relay(request(validBody, {
      origin: "https://reader.example.ts.net",
      "x-forwarded-host": "reader.example.ts.net", "x-forwarded-proto": "https",
    }))).status).toBe(200);
    // Forwarded headers never turn a metadata-free or cross-site caller into an admitted browser.
    const spoof = new Request(endpoint, { method: "POST", body: validBody, headers: {
      host: "localhost:3110", origin: "https://reader.example.ts.net", "content-type": "application/json",
      "x-forwarded-host": "reader.example.ts.net", "x-forwarded-proto": "https",
    } });
    expect((await relay(spoof)).status).toBe(403);
    expect((await relay(request(validBody, {
      "sec-fetch-site": "cross-site", origin: "https://reader.example.ts.net",
      "x-forwarded-host": "reader.example.ts.net", "x-forwarded-proto": "https",
    }))).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("requires exact origin when fetch metadata is missing and never admits a headerless caller", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json());
    const relay = createWikimediaRelay(fetch);
    const make = (origin?: string) => new Request(endpoint, {
      method: "POST", body: validBody,
      headers: { host: "localhost:3110", "content-type": "application/json", ...(origin ? { origin } : {}) },
    });
    expect((await relay(make())).status).toBe(403);
    expect((await relay(make("http://localhost:3110"))).status).toBe(200);
    expect((await relay(make("https://localhost:3110"))).status).toBe(403);
    expect((await relay(make("https://evil.example"))).status).toBe(403);
    expect((await relay(make("http://localhost:3100"))).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"])("does no upstream work for %s", async (method) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect((await createWikimediaRelay(fetch)(new Request(endpoint, { method }))).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["bad", {}, 400],
    [validBody, { "content-type": "text/plain" }, 400],
    [validBody, { "content-encoding": "gzip" }, 400],
    [validBody, { "content-length": "-1" }, 413],
    [validBody, { "content-length": String(WIKIMEDIA_REQUEST_BYTES + 1) }, 413],
    [validBody, { "content-length": "1" }, 400],
    [JSON.stringify({ ...input, url: "http://127.0.0.1/" }), {}, 400],
    [JSON.stringify({ ...input, operation: "query" }), {}, 400],
    [JSON.stringify({ ...input, title: "a".repeat(4097) }), {}, 400],
    [JSON.stringify({ ...input, title: ".." }), {}, 400],
  ] as [string, Record<string, string>, number][])("rejects invalid body/header %s before fetch", async (body, headers, status) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect((await createWikimediaRelay(fetch)(request(body, headers))).status).toBe(status);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds chunked request bytes and accepts exactly 32 KiB", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json()), relay = createWikimediaRelay(fetch);
    const exact = validBody + " ".repeat(WIKIMEDIA_REQUEST_BYTES - new TextEncoder().encode(validBody).byteLength);
    expect((await relay(request(rawStream(new TextEncoder().encode(exact))))).status).toBe(200);
    expect((await relay(request(rawStream(new TextEncoder().encode(exact + " "))))).status).toBe(413);
    expect((await relay(request(rawStream(new Uint8Array([0xff]))))).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("admits worst-case escaping of a 4096-unit title inside the request limit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json());
    const body = JSON.stringify({ ...input, title: "\u0000".repeat(4096) });
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(WIKIMEDIA_REQUEST_BYTES);
    expect((await createWikimediaRelay(fetch)(request(body))).status).toBe(200);
  });
  it("times out a stalled request body and releases capacity", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(), fetch = vi.fn<typeof globalThis.fetch>(async () => json());
    const relay = createWikimediaRelay(fetch);
    const pending = relay(request(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(LOOKUP_LIMITS.requestTimeoutMs);
    expect((await pending).headers.get(WIKIMEDIA_RELAY_ERROR)).toBe("timeout");
    expect(cancel).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
    expect((await relay(request())).status).toBe(200);
  });
});

describe("bounded credential-free Wikimedia acquisition", () => {
  it.each(["definition", "summary", "parse"] as const)("builds exactly the %s endpoint and drops caller credentials", async (operation) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json()), relay = createWikimediaRelay(fetch);
    const body = { operation, language: "fr", title: "a/b ?#%" };
    expect((await relay(request(JSON.stringify(body), { Cookie: "session=private", Authorization: "Bearer private", Referer: "https://private.example/book" }))).status).toBe(200);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(wikimediaAddress(body));
    expect(options).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(options!.headers).toEqual({ Accept: "application/json", "User-Agent": WIKIMEDIA_API_USER_AGENT, "Api-User-Agent": WIKIMEDIA_API_USER_AGENT });
  });
  it("returns original JSON bytes and recreates only safe headers", async () => {
    const body = ' { "number":1e-6, "text":"café" }\n';
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(body, {
      "Set-Cookie": "provider=private", Location: "https://example.org", "Access-Control-Allow-Origin": "*", [WIKIMEDIA_RELAY_ERROR]: "network",
    }));
    const relay = createWikimediaRelay(fetch);
    const response = await relay(request());
    expect(response.status).toBe(200); expect(await response.text()).toBe(body);
    expect([...response.headers]).toEqual([
      ["cache-control", "no-store"], ["content-length", String(new TextEncoder().encode(body).byteLength)], ["content-type", "application/json"],
    ]);
    expect((await relay(request())).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2); // No process-wide result cache.
  });
  it.each([404, 403, 500, 503])("retains HTTP %s without provider response data", async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("private upstream error", { status, headers: { "Set-Cookie": "private", Location: "https://example.org" } }));
    const response = await createWikimediaRelay(fetch)(request());
    expect(response.status).toBe(status); expect(await response.text()).toBe("");
    expect([...response.headers]).toEqual([["cache-control", "no-store"]]);
  });
  it("enforces per-host Retry-After across requests without retries", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 429, headers: { "Retry-After": "9999" } }));
    const relay = createWikimediaRelay(fetch);
    const first = await relay(request());
    expect(first.status).toBe(429); expect(first.headers.get("Retry-After")).toBe("60");
    expect((await relay(request(JSON.stringify({ ...input, title: "other" })))).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect((await relay(request())).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["definition", "parse"] as const)("caps streamed %s responses even with a false low Content-Length", async (operation) => {
    const maximum = operation === "parse" ? LOOKUP_LIMITS.parseResponseBytes : LOOKUP_LIMITS.responseBytes;
    const text = '"' + "a".repeat(maximum - 2) + '"';
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(text, { "Content-Length": "1" }));
    const relay = createWikimediaRelay(fetch), body = JSON.stringify({ ...input, operation });
    expect((await relay(request(body))).status).toBe(200);
    fetch.mockImplementation(async () => new Response(rawStream(new TextEncoder().encode(text + " ")), { headers: { "Content-Type": "application/json" } }));
    const rejected = await relay(request(body));
    expect(rejected.status).toBe(502); expect(rejected.headers.get(WIKIMEDIA_RELAY_ERROR)).toBe("invalid");
  });
  it.each([
    () => new Response("{}", { headers: { "Content-Type": "text/html" } }),
    () => json("{}", { "Content-Length": String(LOOKUP_LIMITS.responseBytes + 1) }),
    () => json("{}", { "Content-Length": "bad" }),
    () => json("not JSON"),
    () => new Response(rawStream(new Uint8Array([0xff])), { headers: { "Content-Type": "application/json" } }),
    () => new Response(null, { status: 204, headers: { "Content-Type": "application/json" } }),
  ])("rejects malformed upstream response %#", async (make) => {
    const response = await createWikimediaRelay(async () => make())(request());
    expect(response.status).toBe(502); expect(response.headers.get(WIKIMEDIA_RELAY_ERROR)).toBe("invalid");
  });
  it("maps fetch/redirect errors without leaking error details", async () => {
    const response = await createWikimediaRelay(async () => { throw new TypeError("private redirect URL"); })(request());
    expect(response.status).toBe(502); expect(response.headers.get(WIKIMEDIA_RELAY_ERROR)).toBe("network");
    expect(await response.text()).toBe("");
  });
  it("aborts an upstream stalled body at four seconds and releases the slot", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(), fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } }));
    const relay = createWikimediaRelay(fetch), pending = relay(request());
    await vi.advanceTimersByTimeAsync(LOOKUP_LIMITS.requestTimeoutMs);
    const response = await pending;
    expect(response.status).toBe(504); expect(response.headers.get(WIKIMEDIA_RELAY_ERROR)).toBe("timeout");
    expect(cancel).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => json());
    expect((await relay(request())).status).toBe(200);
  });
  it("times out a stalled native fetch and cancels its signal", async () => {
    vi.useFakeTimers();
    let upstreamSignal: AbortSignal | null | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_, options) => {
      upstreamSignal = options!.signal;
      return new Promise((_, reject) => upstreamSignal!.addEventListener("abort", () => reject(upstreamSignal!.reason), { once: true }));
    });
    const relay = createWikimediaRelay(fetch), pending = relay(request());
    await vi.advanceTimersByTimeAsync(LOOKUP_LIMITS.requestTimeoutMs);
    expect((await pending).headers.get(WIKIMEDIA_RELAY_ERROR)).toBe("timeout");
    expect(upstreamSignal!.aborted).toBe(true);
    fetch.mockImplementation(async () => json());
    expect((await relay(request())).status).toBe(200);
  });
  it("bounds the shared queue and removes canceled waiters before fetching", async () => {
    const finishes: ((value: Response) => void)[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise((resolve) => finishes.push(resolve)));
    const relay = createWikimediaRelay(fetch), controllers = Array.from({ length: 67 }, () => new AbortController());
    const pending = controllers.map((controller) => relay(request(validBody, {}, { signal: controller.signal })));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect((await relay(request())).status).toBe(429);
    controllers.slice(3).forEach((controller) => controller.abort(new DOMException("closed", "AbortError")));
    finishes.forEach((finish) => finish(json()));
    const responses = await Promise.all(pending);
    expect(responses.slice(0, 3).every((response) => response.status === 200)).toBe(true);
    expect(responses.slice(3).every((response) => response.status === 499)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockImplementation(async () => json());
    expect((await relay(request())).status).toBe(200);
  });
  it("propagates caller abort into active fetch and body consumption", async () => {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | null | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_, options) => {
      upstreamSignal = options!.signal;
      return new Promise((_, reject) => upstreamSignal!.addEventListener("abort", () => reject(upstreamSignal!.reason), { once: true }));
    });
    const relay = createWikimediaRelay(fetch), pending = relay(request(validBody, {}, { signal: controller.signal }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("closed", "AbortError"));
    expect((await pending).status).toBe(499); expect(upstreamSignal!.aborted).toBe(true);
    const cancel = vi.fn(), second = new AbortController();
    fetch.mockImplementation(async () => new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } }));
    const bodyPending = relay(request(validBody, {}, { signal: second.signal }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    second.abort(); expect((await bodyPending).status).toBe(499); expect(cancel).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => json()); expect((await relay(request())).status).toBe(200);
  });
});
