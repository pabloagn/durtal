// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserLookupTranslator } from "@/lib/reader/lookup/browser-translator";
import { DEEPL_SOURCE_LANGUAGES, GOOGLE_LANGUAGES } from "@/lib/reader/lookup/provider-languages";
afterEach(() => { delete (self as typeof self & { Translator?: unknown }).Translator; });
const native = (api: object) => Object.defineProperty(self, "Translator", { configurable: true, value: api });
describe("native translator adapter (mock native API; not browser availability evidence)", () => {
  it("has no fabricated availability when the browser exposes no API", async () => {
    const session = new BrowserLookupTranslator();
    expect(await session.availability("es", "en", new AbortController().signal)).toBeNull();
    session.close();
  });
  it.each(["available", "downloadable", "downloading", "unavailable"] as const)("uses native %s without creating/downloading a model", async status => {
    const create = vi.fn(); native({ availability: vi.fn(async () => status), create });
    const session = new BrowserLookupTranslator();
    expect(await session.availability("es", "en", new AbortController().signal)).toBe(status);
    expect(create).not.toHaveBeenCalled(); session.close();
  });
  it("starts native create in the click stack, bounds pairs, and releases all sessions", async () => {
    const instances: { translate: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
    const create = vi.fn(() => {
      const instance = { translate: vi.fn(async () => "translated"), destroy: vi.fn() };
      instances.push(instance); return Promise.resolve(instance);
    });
    native({ availability: async () => "available", create });
    const session = new BrowserLookupTranslator(), signal = new AbortController().signal;
    const first = session.translate("es", "en", "casa", signal);
    expect(create).toHaveBeenCalledTimes(1); await first;
    await session.translate("es", "en", "otra", signal);
    expect(create).toHaveBeenCalledTimes(1);
    for (const source of ["fr", "de", "it", "ja", "nl", "pt", "ru", "he"])
      await session.translate(source, "en", "text", signal);
    expect(instances[0].destroy).toHaveBeenCalledTimes(1);
    session.close(); expect(instances.every(instance => instance.destroy.mock.calls.length === 1)).toBe(true);
  });
  it("cancels delivery and destroys a native model that resolves after cancellation", async () => {
    let resolve!: (value: { translate: () => Promise<string>; destroy: ReturnType<typeof vi.fn> }) => void;
    native({ availability: async () => "downloadable", create: () => new Promise(value => { resolve = value; }) });
    const session = new BrowserLookupTranslator(), controller = new AbortController();
    const pending = session.translate("es", "en", "text", controller.signal);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const destroy = vi.fn(); resolve({ translate: async () => "late", destroy });
    await Promise.resolve(); expect(destroy).toHaveBeenCalledTimes(1); session.close();
  });
  it("verified provider lists retain historical languages only when actually listed", () => {
    expect(DEEPL_SOURCE_LANGUAGES.has("la")).toBe(true);
    expect(DEEPL_SOURCE_LANGUAGES.has("grc")).toBe(false);
    expect(GOOGLE_LANGUAGES.has("la")).toBe(true);
    expect(GOOGLE_LANGUAGES.has("grc")).toBe(false);
  });
});
