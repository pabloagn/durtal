// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOOKUP_LIMITS,
  WIKIMEDIA_API_USER_AGENT,
} from "@/lib/reader/lookup/policy";
import { lookupWiktionary } from "@/lib/reader/lookup/wiktionary";
import { lookupWikipedia } from "@/lib/reader/lookup/wikipedia";
import { WikimediaClient } from "@/lib/reader/lookup/wikimedia";

const signal = () => new AbortController().signal;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const definition = (language = "la", text = "synthetic gloss") => ({
  [language]: [
    {
      partOfSpeech: "Noun",
      language: "Latin",
      definitions: [{ definition: text }],
    },
  ],
});
const summary = (language = "en", extract = "synthetic summary") => ({
  titles: { display: "Example" },
  extract_html: `<p>${extract}</p>`,
  dir: "ltr",
  content_urls: {
    desktop: { page: `https://${language}.wikipedia.org/wiki/Example` },
  },
});
const address = (title: string) =>
  `https://en.wiktionary.org/api/rest_v1/page/definition/${title}`;
afterEach(() => vi.useRealTimers());

describe("Wikimedia acquisition", () => {
  it("uses only approved endpoints, identifies every call, and omits credentials/referrers/redirects", async () => {
    const request = vi.fn<typeof fetch>(async () => response(definition()));
    const client = new WikimediaClient(request);
    const result = await lookupWiktionary("la", ["ad hoc"], undefined, client);
    expect(result.english.status).toBe("fulfilled");
    expect(request.mock.calls[0]).toMatchObject([
      address("ad_hoc"),
      {
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        headers: { "Api-User-Agent": WIKIMEDIA_API_USER_AGENT },
      },
    ]);
    for (const url of [
      "http://en.wiktionary.org/api/rest_v1/page/definition/lux",
      "https://example.org/api/rest_v1/page/definition/lux",
      "https://en.wiktionary.org:444/api/rest_v1/page/definition/lux",
      "https://en.wiktionary.org/w/index.php?search=lux",
      "https://en.wiktionary.org/w/api.php?action=query",
      `${address("lux")}#fragment`,
    ])
      await expect(client.json(url, signal())).rejects.toThrow(
        /Invalid Wikimedia/,
      );
    expect(request).toHaveBeenCalledTimes(1);
    await lookupWiktionary("la", ["a/b"], undefined, client);
    expect(request.mock.calls[1][0]).toBe(address("a%2Fb"));
  });
  it("tries original then lowercase, keeps 404 out of parse, and falls back once on failure", async () => {
    const request = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("Lux") ? response({}, 404) : response(definition()),
    );
    const client = new WikimediaClient(request);
    const result = await lookupWiktionary(
      "la",
      ["Lux", "lux"],
      undefined,
      client,
    );
    expect(result.english).toMatchObject({
      status: "fulfilled",
      value: { word: "lux", found: true },
    });
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      address("Lux"),
      address("lux"),
    ]);
    const fallback = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("/api/rest_v1/")
        ? response({}, 503)
        : response({ parse: { text: "<h2>Latin</h2><p>fallback gloss</p>" } }),
    );
    const parsed = await lookupWiktionary(
      "la",
      ["lux"],
      undefined,
      new WikimediaClient(fallback),
    );
    expect(parsed.english).toMatchObject({
      status: "fulfilled",
      value: { format: "html", found: true, html: "<p>fallback gloss</p>" },
    });
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(
      new URL(String(fallback.mock.calls[1][0])).searchParams.get("page"),
    ).toBe("lux");
    const missing = vi.fn<typeof fetch>(async () => response({}, 404));
    expect(
      (
        await lookupWiktionary(
          "la",
          ["lux"],
          undefined,
          new WikimediaClient(missing),
        )
      ).english,
    ).toMatchObject({ status: "fulfilled", value: { found: false } });
    expect(missing).toHaveBeenCalledTimes(1);
  });
  it.each(["es", "fr", "de", "it"])(
    "acquires the %s edition alongside English, with exact-language parsing",
    async (language) => {
      const name = new Intl.DisplayNames([language], { type: "language" }).of(
        language,
      )!;
      const request = vi.fn<typeof fetch>(async (url) =>
        String(url).includes("/api/rest_v1/")
          ? response(definition(language))
          : response({
              parse: {
                text: `<h2>Other ${name}</h2><p>wrong</p><h2>${name}</h2><p>own gloss</p>`,
              },
            }),
      );
      const result = await lookupWiktionary(
        language,
        ["word"],
        undefined,
        new WikimediaClient(request),
      );
      expect(result.english).toMatchObject({
        status: "fulfilled",
        value: { found: true },
      });
      expect(result.own).toMatchObject({
        status: "fulfilled",
        value: { found: true, html: "<p>own gloss</p>" },
      });
      expect(request).toHaveBeenCalledTimes(2);
    },
  );
  it("caps active requests and removes a canceled queued request before it can fetch", async () => {
    const releases: (() => void)[] = [];
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) =>
          releases.push(() => resolve(response({ ok: true }))),
        ),
    );
    const client = new WikimediaClient(request),
      controllers = Array.from({ length: 4 }, () => new AbortController());
    const pending = controllers.map((controller, index) =>
      client.json(address(String(index)), controller.signal),
    );
    const settled = Promise.allSettled(pending);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    controllers[3].abort(new DOMException("canceled", "AbortError"));
    releases.forEach((release) => release());
    expect((await settled)[3]).toMatchObject({
      status: "rejected",
      reason: { name: "AbortError" },
    });
    expect(request).toHaveBeenCalledTimes(LOOKUP_LIMITS.concurrentRequests);
  });
  it("aborts a stalled response body and enforces streamed size even without Content-Length", async () => {
    const canceled = vi.fn(),
      controller = new AbortController();
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(new ReadableStream({ cancel: canceled }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    const pending = new WikimediaClient(request).json(
      address("stall"),
      controller.signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("closed", "AbortError"));
    await rejected;
    expect(canceled).toHaveBeenCalledTimes(1);
    const large = new WikimediaClient(
      async () =>
        new Response(
          new ReadableStream({
            start(output) {
              output.enqueue(new Uint8Array(LOOKUP_LIMITS.responseBytes + 1));
              output.close();
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    await expect(large.json(address("large"), signal())).rejects.toMatchObject({
      kind: "invalid",
    });
  });
  it("times out native acquisition and observes bounded Retry-After without retrying", async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>(
      (_, options) =>
        new Promise((_, reject) =>
          options!.signal!.addEventListener(
            "abort",
            () => reject(options!.signal!.reason),
            { once: true },
          ),
        ),
    );
    const pending = new WikimediaClient(request).json(
      address("slow"),
      signal(),
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(LOOKUP_LIMITS.requestTimeoutMs);
    await rejected;
    const limited = vi.fn<typeof fetch>(
      async () =>
        new Response("", { status: 429, headers: { "Retry-After": "9999" } }),
    );
    const client = new WikimediaClient(limited);
    await expect(client.json(address("rate"), signal())).rejects.toMatchObject({
      status: 429,
    });
    await expect(client.json(address("other"), signal())).rejects.toMatchObject(
      { status: 429 },
    );
    expect(limited).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    await expect(client.json(address("other"), signal())).rejects.toMatchObject(
      { status: 429 },
    );
    expect(limited).toHaveBeenCalledTimes(2);
  });
  it("uses an LRU of 200 entries without allowing cached caller mutation", async () => {
    const request = vi.fn<typeof fetch>(async () =>
        response({ nested: { value: "original" } }),
      ),
      client = new WikimediaClient(request);
    const first = (await client.json(address("first"), signal())) as {
      nested: { value: string };
    };
    first.nested.value = "changed";
    expect(await client.json(address("first"), signal())).toEqual({
      nested: { value: "original" },
    });
    for (let index = 0; index < 200; index++)
      await client.json(address(String(index)), signal());
    await client.json(address("first"), signal());
    expect(request).toHaveBeenCalledTimes(202);
  });
  it("falls back to English Wikipedia once on a missing or nonexistent wiki", async () => {
    const request = vi.fn<typeof fetch>(async (url) =>
      String(url).startsWith("https://grc.")
        ? Promise.reject(new TypeError("network"))
        : response(summary()),
    );
    const result = await lookupWikipedia(
      "grc",
      "Example",
      undefined,
      new WikimediaClient(request),
    );
    expect(result).toMatchObject({
      found: true,
      language: "en",
      fromEnglish: true,
    });
    expect(request).toHaveBeenCalledTimes(2);
    const empty = vi.fn<typeof fetch>(async (url) =>
      response(
        summary(
          String(url).startsWith("https://la.") ? "la" : "en",
          String(url).startsWith("https://la.") ? "" : "English gloss",
        ),
      ),
    );
    expect(
      await lookupWikipedia(
        "la",
        "Example",
        undefined,
        new WikimediaClient(empty),
      ),
    ).toMatchObject({ found: true, fromEnglish: true });
    expect(empty).toHaveBeenCalledTimes(2);
  });
  it("bounds cached bytes and replaces concurrent duplicate cache entries correctly", async () => {
    const request = vi.fn<typeof fetch>(async () =>
        response({ text: "a".repeat(LOOKUP_LIMITS.responseBytes - 1024) }),
      ),
      client = new WikimediaClient(request);
    await Promise.all([
      client.json(address("large-first"), signal()),
      client.json(address("large-first"), signal()),
    ]);
    await client.json(address("large-first"), signal());
    expect(request).toHaveBeenCalledTimes(2);
    await client.json(address("large-second"), signal());
    await client.json(address("large-first"), signal());
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("publishes a ready English section while the native-language section is still pending", async () => {
    let finishOwn: ((value: Response) => void) | undefined;
    const request = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("/api/rest_v1/")
        ? response(definition("fr"))
        : new Promise<Response>((resolve) => {
            finishOwn = resolve;
          }),
    );
    const english = vi.fn(),
      own = vi.fn();
    const pending = lookupWiktionary(
      "fr",
      ["word"],
      undefined,
      new WikimediaClient(request),
      { english, own },
    );
    await vi.waitFor(() => expect(english).toHaveBeenCalledTimes(1));
    expect(own).not.toHaveBeenCalled();
    finishOwn!(
      response({ parse: { text: "<h2>Français</h2><p>own gloss</p>" } }),
    );
    await pending;
    expect(own).toHaveBeenCalledTimes(1);
  });
});
