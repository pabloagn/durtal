// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WikimediaClient } from "@/lib/reader/lookup/wikimedia";
import { lookupWiktionary } from "@/lib/reader/lookup/wiktionary";
import { lookupWikipedia } from "@/lib/reader/lookup/wikipedia";
import {
  WIKIMEDIA_RELAY_ERROR, WIKIMEDIA_RELAY_PATH,
  wikimediaAddress, wikimediaRequest, wikimediaRequestFromAddress,
} from "@/lib/reader/lookup/wikimedia-protocol";

const signal = () => new AbortController().signal;
const json = (value: unknown) => new Response(JSON.stringify(value), {
  headers: { "Content-Type": "application/json" },
});
const definition = { en: [{ partOfSpeech: "Noun", language: "English", definitions: [{ definition: "a volume" }] }] };
const address = (title: string) => wikimediaAddress({ operation: "definition", language: "en", title });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("same-origin Wikimedia transport", () => {
  it.each(["definition", "summary", "parse"] as const)("sends %s only through the fixed POST route", async (operation) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ value: true }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await new WikimediaClient().json(wikimediaAddress({ operation, language: "fr", title: "a/b ?#%" }), controller.signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(WIKIMEDIA_RELAY_PATH);
    expect(options).toMatchObject({ method: "POST", mode: "same-origin", credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(options!.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(JSON.parse(String(options!.body))).toEqual({ operation, language: "fr", title: "a/b ?#%" });
    expect(options!.signal).toBeInstanceOf(AbortSignal);
  });

  it("retains successful browser caching without forwarding caller mutation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ nested: { value: "original" } }));
    vi.stubGlobal("fetch", fetch);
    const client = new WikimediaClient();
    const first = await client.json(address("cached"), signal()) as { nested: { value: string } };
    first.nested.value = "changed";
    expect(await client.json(address("cached"), signal())).toEqual({ nested: { value: "original" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "invalid", "timeout"])("preserves controlled relay %s failures and cancels their body", async (kind) => {
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ cancel }), {
      status: 502, headers: { [WIKIMEDIA_RELAY_ERROR]: kind },
    }));
    vi.stubGlobal("fetch", fetch);
    const client = new WikimediaClient();
    await expect(client.json(address("failed"), signal())).rejects.toMatchObject(kind === "timeout" ? { name: "TimeoutError" } : { kind });
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(client.json(address("failed"), signal())).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a 404 out of parse fallback and tries the lowercase title", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, options) => {
      const request = JSON.parse(String(options!.body));
      return request.title === "Book" ? new Response(null, { status: 404 }) : json(definition);
    });
    vi.stubGlobal("fetch", fetch);
    expect((await lookupWiktionary("en", ["Book", "book"], undefined, new WikimediaClient())).english).toMatchObject({ status: "fulfilled", value: { found: true, word: "book" } });
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(String(options!.body)).operation)).toEqual(["definition", "definition"]);
  });

  it("uses the existing single parse fallback for a relay network failure", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, options) => JSON.parse(String(options!.body)).operation === "definition"
      ? new Response(null, { status: 502, headers: { [WIKIMEDIA_RELAY_ERROR]: "network" } })
      : json({ parse: { text: "<h2>English</h2><p>fallback gloss</p>" } }));
    vi.stubGlobal("fetch", fetch);
    expect((await lookupWiktionary("en", ["Book", "book"], undefined, new WikimediaClient())).english).toMatchObject({ status: "fulfilled", value: { found: true } });
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(String(options!.body)).operation)).toEqual(["definition", "parse"]);
  });

  it("keeps requested-language Wikipedia failure followed by English fallback", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, options) => {
      const input = JSON.parse(String(options!.body));
      return input.language === "grc" ? new Response(null, { status: 502, headers: { [WIKIMEDIA_RELAY_ERROR]: "network" } })
        : json({ titles: { display: "Book" }, extract_html: "<p>A volume</p>", dir: "ltr", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Book" } } });
    });
    vi.stubGlobal("fetch", fetch);
    expect(await lookupWikipedia("grc", "Book", undefined, new WikimediaClient())).toMatchObject({ found: true, language: "en", fromEnglish: true });
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(String(options!.body)).language)).toEqual(["grc", "en"]);
  });

  it("keeps the bounded host cooldown on a relayed 429", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 429, headers: { "Retry-After": "9999" } }));
    vi.stubGlobal("fetch", fetch);
    const client = new WikimediaClient();
    await expect(client.json(address("one"), signal())).rejects.toMatchObject({ kind: "rate-limit", status: 429 });
    await expect(client.json(address("two"), signal())).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    await expect(client.json(address("two"), signal())).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("propagates parent cancellation to the app request and preserves its reason", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_, options) => new Promise((_, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController(), reason = new DOMException("closed", "AbortError");
    const pending = new WikimediaClient().json(address("abort"), controller.signal);
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort(reason);
    await rejected;
  });
});

describe("fixed Wikimedia operation contract", () => {
  it.each(["a/b", "50%", "a?b#c", "a_b", "two words", "café 東京"])("round-trips title data %s exactly once", (title) => {
    for (const operation of ["definition", "summary", "parse"] as const) {
      const input = { operation, language: "en", title };
      expect(wikimediaRequestFromAddress(wikimediaAddress(input))).toEqual(input);
    }
  });
  it.each([
    "http://en.wiktionary.org/api/rest_v1/page/definition/book",
    "https://example.org/api/rest_v1/page/definition/book",
    "https://en.wiktionary.org:444/api/rest_v1/page/definition/book",
    "https://user@en.wiktionary.org/api/rest_v1/page/definition/book",
    "https://en.wiktionary.org/api/rest_v1/page/definition/book#fragment",
    "https://en.wiktionary.org/api/rest_v1/page/definition/book?url=https://example.org",
    "https://en.wiktionary.org/w/index.php?search=book",
  ])("rejects acquisition address %s", (url) => expect(() => wikimediaRequestFromAddress(url)).toThrow());
  it("rejects extra, duplicate and changed parse parameters", () => {
    const url = wikimediaAddress({ operation: "parse", language: "en", title: "book" });
    for (const address of [url + "&url=https://example.org", url + "&page=other", url.replace("redirects=1", "redirects=0")])
      expect(() => wikimediaRequestFromAddress(address)).toThrow();
  });
  it("rejects URL passthrough, wrong fields and normalized dot paths", () => {
    const input = { operation: "definition", language: "en", title: "book" } as const;
    for (const value of [{ ...input, url: "https://example.org" }, { ...input, language: "en.example" }, { ...input, operation: "query" }, { ...input, title: "" }, { ...input, title: "a".repeat(4097) }])
      expect(() => wikimediaRequest(value)).toThrow();
    for (const title of [".", "..", "\ud800"])
      expect(() => wikimediaAddress({ ...input, title })).toThrow();
  });
});
