import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_OPTIONS as defaults,
  findInText,
  foldForSearch,
  minQueryLength,
  onWordBoundaries,
  queryRuns,
  safeLocale,
} from "@/lib/reader/search/fold";
import {
  nodeBoundary,
  rangeOffsets,
  textOffsets,
} from "@/lib/reader/search/offsets";

const matches = (text: string, query: string, switches = {}, language = "fr") =>
  [...findInText(text, query, { ...defaults, ...switches }, language)].map(
    (range) => text.slice(range.start, range.end),
  );

describe("search folding and original offsets", () => {
  it("finds the three accent/case fixture forms by default", () => {
    expect(matches("Là-bas La-bas LÀ-BAS", "La-bas")).toEqual([
      "Là-bas",
      "La-bas",
      "LÀ-BAS",
    ]);
  });
  it("implements each independent switch", () => {
    const text = "Là-bas La-bas LÀ-BAS";
    expect(matches(text, "La-bas", { matchCase: true })).toEqual([
      "Là-bas",
      "La-bas",
    ]);
    expect(matches(text, "La-bas", { matchAccents: true })).toEqual(["La-bas"]);
    expect(
      matches("École école Ecole", "École", {
        matchCase: true,
        matchAccents: true,
      }),
    ).toEqual(["École"]);
  });
  it.each([
    ["straße", "strasse"],
    ["æther", "aether"],
    ["œuvre", "oeuvre"],
    ["ø ł đ ı", "o l d i"],
    ["ﬃ", "ffi"],
  ])("maps %s back from %s", (source, query) => {
    expect(matches(source, query)).toEqual([source]);
  });
  it("preserves accents when requested", () => {
    expect(
      matches("café cafe\u0301 cafe", "café", { matchAccents: true }),
    ).toEqual(["café", "cafe\u0301"]);
    expect(matches("é", "e", { matchAccents: true })).toEqual([]);
  });
  it("includes the decomposed accent in the source range", () => {
    expect([...findInText("a e\u0301 z", "e", defaults)]).toEqual([
      { start: 2, end: 4 },
    ]);
  });
  it("cannot select half an expansion, including before soft hyphens", () => {
    expect(matches("ß\u00ad", "s")).toEqual([]);
    expect(matches("ß\u00ad", "ss")).toEqual(["ß\u00ad"]);
    expect(matches("ﬃ", "fi")).toEqual([]);
  });
  it("has UTF-16 offsets for supplementary characters", () => {
    expect([...findInText("x😀ß", "😀ss", defaults)]).toEqual([
      { start: 1, end: 4 },
    ]);
  });
  it("normalizes formatting and whitespace without losing the original range", () => {
    expect(matches("co\u00adoperate \n\t now", "cooperate now")).toEqual([
      "co\u00adoperate \n\t now",
    ]);
  });
  it("uses the declared language, including Turkish dotted I", () => {
    expect(matches("İ I ı i", "i", { matchAccents: true }, "tr")).toEqual([
      "İ",
      "i",
    ]);
    expect(matches("ΟΣ ος οσ", "οσ", {}, "el")).toEqual(["ΟΣ", "ος", "οσ"]);
    expect(matches("ЁЛКА ёлка елка", "елка", {}, "ru")).toHaveLength(3);
  });
  it("has a deterministic invalid-locale fallback", () => {
    expect(safeLocale("bad_locale")).toBe("en");
    expect(safeLocale(null)).toBe("en");
  });
  it("rejects substrings of words, punctuation and clipped long words", () => {
    expect(matches("party art artist", "art", { wholeWords: true })).toEqual([
      "art",
    ]);
    expect(onWordBoundaries("---", 0, 3)).toBe(false);
    expect(onWordBoundaries("x".repeat(80) + "art", 80, 83)).toBe(false);
    expect(
      matches("art gallery and art", "art gallery", { wholeWords: true }),
    ).toEqual(["art gallery"]);
  });
  it("supports CJK minimum queries and ignores zero-width-only input", () => {
    for (const lang of ["zh-Hant", "ja", "ko-KR"]) {
      expect(minQueryLength(lang)).toBe(1);
      expect(queryRuns("字", lang)).toBe(true);
    }
    expect(queryRuns("a", "en")).toBe(false);
    expect(queryRuns("a\u200b", "en")).toBe(false);
    expect(queryRuns("\u0301\u0300", "fr")).toBe(false);
  });
  it("returns overlapping matches lazily with a hard result bound", () => {
    expect(matches("banana", "ana")).toEqual(["ana", "ana"]);
    expect([...findInText("a".repeat(5_010), "a", defaults)]).toHaveLength(
      5_000,
    );
    expect([
      ...findInText("aaa", "a", defaults, "en", undefined, 2),
    ]).toHaveLength(2);
    expect(() => [
      ...findInText("a", "a", defaults, "en", undefined, 5_001),
    ]).toThrow(RangeError);
  });
  it("does not retain an unused result list when the consumer stops", () => {
    const run = findInText("aaaa", "a", defaults);
    expect(run.next().value).toEqual({ start: 0, end: 1 });
    run.return(undefined);
    expect(run.next().done).toBe(true);
  });
});

describe("text-node offset indexing", () => {
  it("maps a match across markup and empty nodes", () => {
    const strings = ["", "La", "", "-", "bas", ""];
    expect(rangeOffsets(textOffsets(strings), 1, 5)).toEqual({
      start: { index: 1, offset: 1 },
      end: { index: 4, offset: 2 },
    });
  });
  it("assigns exact starts and ends to the right text nodes", () => {
    const index = textOffsets(["a", "", "b", ""]);
    expect(nodeBoundary(index, 1, "start")).toEqual({ index: 2, offset: 0 });
    expect(nodeBoundary(index, 1, "end")).toEqual({ index: 0, offset: 1 });
    expect(nodeBoundary(index, 2, "end")).toEqual({ index: 2, offset: 1 });
  });
  it("keeps offsets in UTF-16 and refuses invalid ranges", () => {
    expect(rangeOffsets(textOffsets(["😀", "ß"]), 0, 3)).toEqual({
      start: { index: 0, offset: 0 },
      end: { index: 1, offset: 1 },
    });
    expect(() => rangeOffsets(textOffsets(["a"]), 0, 2)).toThrow(RangeError);
    expect(() => rangeOffsets(textOffsets(["a"]), 0, 0)).toThrow(RangeError);
    expect(() => nodeBoundary(textOffsets([]), 0, "end")).toThrow(RangeError);
  });
  it("folds matches across strings back into node ranges", () => {
    const strings = ["Stra", "ß", "e"];
    const [match] = findInText(strings.join(""), "strasse", defaults);
    expect(rangeOffsets(textOffsets(strings), match.start, match.end)).toEqual({
      start: { index: 0, offset: 0 },
      end: { index: 2, offset: 1 },
    });
  });
});
