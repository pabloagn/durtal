import { describe, expect, it, vi } from "vitest";
import {
  languageName,
  languageOptions,
  normalizeLanguage,
} from "@/lib/utils/language";

describe("language codes", () => {
  it.each([
    ["en", "en"],
    ["eng", "en"],
    ["ENG", "en"],
    ["English", "en"],
    ["english", "en"],
    ["fre", "fr"],
    ["fra", "fr"],
    ["French", "fr"],
    ["en-US", "en"],
    ["en_GB", "en"],
    ["ger", "de"],
    ["lat", "la"],
    ["grc", "grc"],
    ["Ancient Greek", "grc"],
    [" es ", "es"],
  ])("stores %s as %s", (raw, code) => {
    expect(normalizeLanguage(raw)).toBe(code);
  });

  it.each([null, undefined, "", "  ", "nonsense", "zz", "und", "mul"])(
    "rejects %s",
    (raw) => {
      expect(normalizeLanguage(raw)).toBeNull();
    },
  );

  it("shows English names and keeps unknown codes", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("grc")).toBe("Ancient Greek");
    expect(languageName("zz")).toBe("zz");
    expect(languageName(null)).toBeNull();
  });

  it("names codes the same way when Intl has no name, so server and browser agree", () => {
    // Chrome's Intl knows no "grc" or "ota": a page must not depend on it
    const of = vi
      .spyOn(Intl.DisplayNames.prototype, "of")
      .mockReturnValue(undefined);
    try {
      expect(languageName("grc")).toBe("Ancient Greek");
      expect(languageName("ota")).toBe("Ottoman Turkish");
      expect(languageName("nb")).toBe("Norwegian Bokmål");
      expect(languageName("fr")).toBe("French");
      expect(languageName("qqq")).toBe("qqq");
    } finally {
      of.mockRestore();
    }
  });

  it("adds a stored code that the list does not have", () => {
    expect(languageOptions("en").filter((o) => o.value === "en")).toHaveLength(1);
    expect(languageOptions("is").at(-1)).toEqual({ value: "is", label: "Icelandic" });
  });
});
