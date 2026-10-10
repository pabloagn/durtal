import { describe, expect, it } from "vitest";
import { findInText, DEFAULT_SEARCH_OPTIONS } from "@/lib/reader/search/fold";
import { search } from "@/vendor/foliate-js/search.js";

describe("folded search parity with the pinned upstream matcher", () => {
  for (const [language, text, query] of [
    [
      "fr",
      "Les voix de Là-bas, la-bas et LÀ-BAS traversent la nuit.",
      "la-bas",
    ],
    ["el", "Το φως και το ΦΩΣ απλώνονται στην πόλη.", "φως"],
    ["ru", "Книга, КНИГА и книга лежат на столе.", "книга"],
  ])
    it(`matches the original offsets for ${language}`, () => {
      const expected = [
        ...search([text], query, {
          locales: language,
          granularity: "grapheme",
          sensitivity: "base",
        }),
      ].map(({ range }) => ({
        start: range.startOffset,
        end: range.endOffset,
      }));
      expect([
        ...findInText(text, query, { ...DEFAULT_SEARCH_OPTIONS }, language),
      ]).toEqual(expected);
    });
});
