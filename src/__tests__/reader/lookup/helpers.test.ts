import { describe, expect, it } from "vitest";
import { lookupLanguage } from "@/lib/reader/lookup/language";
import {
  cleanLookupText,
  lookupCandidates,
  lookupSelection,
} from "@/lib/reader/lookup/candidates";
import {
  DEFAULT_LOOKUP_SOURCES,
  defaultLookupSettings,
  lookupSettings,
  lookupSourceUrl,
  sourcesForLanguage,
} from "@/lib/reader/lookup/sources";
import {
  lookupSettingsSchema,
  lookupSourceSchema,
} from "@/lib/validations/reader-lookup";
import {
  retryAfterMs,
  wikimediaTitle,
  wikimediaUrl,
} from "@/lib/reader/lookup/policy";
import {
  translationLinks,
  translationMode,
} from "@/lib/reader/lookup/translate";

describe("lookup languages and selection candidates", () => {
  it("uses passage, ebook, edition, then explicitly guessed English", () => {
    expect(
      lookupLanguage({ passage: "lat", ebook: "es", edition: "fr" }),
    ).toEqual({ language: "la", guessed: false });
    expect(
      lookupLanguage({
        passage: "not a language",
        ebook: "en-GB",
        edition: "fr",
      }),
    ).toEqual({ language: "en", guessed: false });
    expect(lookupLanguage({ ebook: "???", edition: "grc" })).toEqual({
      language: "grc",
      guessed: false,
    });
    expect(lookupLanguage({})).toEqual({ language: "en", guessed: true });
  });
  it("removes edge punctuation and invisible characters while preserving internal marks", () => {
    expect(lookupCandidates("«Lux,»", "la")).toEqual(["Lux", "lux"]);
    expect(
      cleanLookupText("¿co\u00adop\u200ber\u200ca\u200dte\u2060\ufeff?"),
    ).toBe("cooperate");
    expect(lookupCandidates(" l'amour-propre! ", "fr")).toEqual([
      "l'amour-propre",
    ]);
    expect(lookupCandidates("cafe\u0301")).toEqual(["café"]);
    expect(lookupCandidates("I", "tr")).toEqual(["I", "ı"]);
    expect(lookupCandidates(",,  ")).toEqual([]);
  });
  it("distinguishes five/six words and refuses overlong translation without truncating text", () => {
    expect(lookupSelection("one two three four five").kind).toBe("word");
    expect(lookupSelection("one two three four five six").kind).toBe("passage");
    expect(lookupSelection("… ").kind).toBe("empty");
    expect(lookupSelection("x".repeat(1000)).translatable).toBe(true);
    expect(lookupSelection("x".repeat(1001))).toMatchObject({
      kind: "word",
      translatable: false,
      text: "x".repeat(1001),
    });
  });
});

describe("lookup sources and preferences", () => {
  const source = DEFAULT_LOOKUP_SOURCES[0];
  it("has the eight complete defaults, and independent fallback values", () => {
    expect(DEFAULT_LOOKUP_SOURCES).toHaveLength(8);
    for (const value of DEFAULT_LOOKUP_SOURCES)
      expect(lookupSourceSchema.safeParse(value).success).toBe(true);
    const first = lookupSettings(null);
    first.sources[0].name = "Changed";
    expect(lookupSettings({ v: 2 })).toEqual(defaultLookupSettings());
    expect(DEFAULT_LOOKUP_SOURCES[0].name).toBe("Logeion");
  });
  it("encodes every placeholder and selects any-language sources", () => {
    expect(
      lookupSourceUrl(
        { ...source, url: "https://example.org/{word}?q={word}" },
        "λόγος/שלום&",
      ),
    ).toBe(
      `https://example.org/${encodeURIComponent("λόγος/שלום&")}?q=${encodeURIComponent("λόγος/שלום&")}`,
    );
    expect(
      sourcesForLanguage(
        [...DEFAULT_LOOKUP_SOURCES, { ...source, language: "*", name: "Any" }],
        "he",
      ).map((value) => value.name),
    ).toEqual(["Sefaria", "Any"]);
  });
  it("refuses bad protocols, credentials, missing placeholders, names, versions and source counts", () => {
    const prefix = "https://example.org/{word}?q=";
    const maximum = {
      ...source,
      name: "n".repeat(40),
      url: prefix + "x".repeat(500 - prefix.length),
    };
    expect(
      lookupSettingsSchema.parse({
        ...defaultLookupSettings(),
        sources: Array(50).fill(maximum),
      }).sources,
    ).toHaveLength(50);
    for (const url of [
      "http://example.org/{word}",
      "javascript:{word}",
      "https://example.org/word",
      "https://user:secret@example.org/{word}",
    ])
      expect(lookupSourceSchema.safeParse({ ...source, url }).success).toBe(
        false,
      );
    expect(
      lookupSourceSchema.safeParse({ ...source, name: "x".repeat(41) }).success,
    ).toBe(false);
    expect(lookupSourceSchema.parse({ ...source, name: "  Name  " }).name).toBe(
      "Name",
    );
    expect(
      lookupSettingsSchema.safeParse({
        ...defaultLookupSettings(),
        sources: Array(51).fill(source),
      }).success,
    ).toBe(false);
    expect(
      lookupSettingsSchema.safeParse({
        ...defaultLookupSettings(),
        translateTo: "en-US",
      }).success,
    ).toBe(false);
    expect(
      lookupSettingsSchema.safeParse({
        ...defaultLookupSettings(),
        key: "secret",
      }).success,
    ).toBe(false);
  });
});

describe("provider address and translation policies", () => {
  it("encodes Wikimedia titles and refuses host/path injection", () => {
    expect(wikimediaTitle("ad hoc")).toBe("ad_hoc");
    expect(wikimediaTitle("a/b")).toBe("a%2Fb");
    expect(
      wikimediaUrl("wikipedia", "la", "/api/rest_v1/page/summary/Roma"),
    ).toBe("https://la.wikipedia.org/api/rest_v1/page/summary/Roma");
    for (const [language, path] of [
      ["en.evil", "/api"],
      ["en", "//evil.org"],
      ["en", "https://evil.org"],
    ])
      expect(() => wikimediaUrl("wikipedia", language, path)).toThrow();
    expect(retryAfterMs("120", 0)).toBe(60000);
    expect(retryAfterMs("invalid", 0)).toBeNull();
    expect(retryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT", 0)).toBe(5000);
  });
  it("uses actual availability and only offers links supported by supplied provider lists", () => {
    expect(translationMode("es", "en", null)).toBe("links");
    expect(translationMode("es", "en", "available")).toBe("device");
    for (const state of ["downloadable", "downloading"] as const)
      expect(translationMode("es", "en", state)).toBe("download");
    expect(translationMode("es", "en", "unavailable")).toBe("links");
    expect(translationMode("en", "en", "available")).toBe("same-language");
    const input = {
      source: "es",
      target: "en",
      text: "# a&b\nnext",
      deeplLanguages: new Set(["es", "en"]),
      googleLanguages: new Set(["es", "en"]),
    };
    const links = translationLinks(input);
    expect(links.deepl).toBe(
      `https://www.deepl.com/translator#es/en/${encodeURIComponent(input.text)}`,
    );
    expect(new URL(links.google!).searchParams.get("text")).toBe(input.text);
    expect(translationLinks({ ...input, source: "grc" }).deepl).toBeNull();
    expect(
      new URL(
        translationLinks({ ...input, source: "grc" }).google!,
      ).searchParams.get("sl"),
    ).toBe("auto");
    expect(translationLinks({ ...input, text: "x".repeat(1001) })).toEqual({
      deepl: null,
      google: null,
    });
  });
});
