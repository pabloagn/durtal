import { describe, expect, it } from "vitest";
import { mattr, proseMetrics, sentenceWords, type FrequencyList } from "@/lib/enrichment/prose-metrics";

/* Prose metrics (SLN-466) on synthetic text, every expected value worked out by hand */

const LIST: FrequencyList = { key: "test-en", version: "1", forms: ["the", "saw", "a", "river"] };

describe("sentences", () => {
  it("ends a sentence at a paragraph break and drops sentences with no word", () => {
    const text = "The cat sat on the mat. The dog ran\n\n* * *\n\nA bird sang";
    expect(sentenceWords(text, "en").map((s) => s.length)).toEqual([6, 3, 3]);
  });

  it("gives the mean and the median sentence length in words", () => {
    const metrics = proseMetrics("The cat sat on the mat. The dog ran\n\nA bird sang", { language: "en" });
    // Lengths 6, 3, 3: mean 12 / 3, median the middle of 3, 3, 6
    expect(metrics).toMatchObject({ sentenceCount: 3, meanSentenceWords: 4, medianSentenceWords: 3 });
    // Two sentences of 2 and 4 words: the median is the mean of the middle two
    expect(proseMetrics("Dogs bark. Cats sit on mats.", { language: "en" })?.medianSentenceWords).toBe(3);
  });
});

describe("rare-word share", () => {
  const TEXT = "Anna saw the river. the river saw Anna. A heron flew.";

  it("counts the tokens outside the top N forms and leaves out names", () => {
    // Top 3: the, saw, a. "Anna" and "A" never appear in lower case, so they are names.
    // Counted: saw the river the river saw heron flew (8); rare: river river heron flew (4)
    const metrics = proseMetrics(TEXT, { language: "en", list: LIST, cutoff: 3 });
    expect(metrics).toMatchObject({ rareWordShare: 0.5, rareWordSkip: null });
  });

  it("keeps capitalised forms in German, which capitalises nouns", () => {
    // All 11 tokens count; rare: anna river river anna heron flew (6)
    expect(proseMetrics(TEXT, { language: "de", list: LIST, cutoff: 3 })?.rareWordShare).toBe(6 / 11);
  });

  it("stays null, with the reason, without a language or an approved list", () => {
    expect(proseMetrics(TEXT, { language: null, list: LIST, cutoff: 3 })).toMatchObject({
      rareWordShare: null,
      rareWordSkip: "language_unknown",
    });
    expect(proseMetrics(TEXT, { language: "en" })).toMatchObject({ rareWordShare: null, rareWordSkip: "no_list" });
  });

  it("stays null, with the reason, when every word is capitalised", () => {
    expect(proseMetrics("Paris London. Rome!", { language: "en", list: LIST, cutoff: 3 })).toMatchObject({
      sentenceCount: 2,
      rareWordShare: null,
      rareWordSkip: "names_only",
      mattr: 1,
    });
  });
});

describe("MATTR", () => {
  it("averages the type-token ratio of every window", () => {
    // Windows of 3: [a b a] 2 types, [b a c] 3, [a c b] 3: (2 + 3 + 3) / (3 * 3)
    expect(mattr(["a", "b", "a", "c", "b"], 3)).toBe(8 / 9);
  });

  it("uses the whole text's ratio when the text is shorter than the window", () => {
    expect(mattr(["a", "b", "a"], 5)).toBe(2 / 3);
  });
});

describe("the text", () => {
  it("is normalised to NFC before any metric", () => {
    // A decomposed and a composed "café" are one type
    expect(proseMetrics("café café", { language: "fr", window: 2 })?.mattr).toBe(1 / 2);
  });

  it("measures nothing in a text with no word made of letters", () => {
    for (const text of ["", "  \n\n  ", "1984. 2001. 42.", "* * *"]) expect(proseMetrics(text, { language: "en" })).toBeNull();
    expect(proseMetrics("Hello", { language: "en" })).toMatchObject({ sentenceCount: 1, meanSentenceWords: 1, medianSentenceWords: 1, mattr: 1 });
  });

  it("keeps apostrophes and hyphens inside a word", () => {
    const text = "Qu'il est beau, l'homme qui c'est dit non.";
    expect(sentenceWords(text, "fr")).toEqual([["Qu'il", "est", "beau", "l'homme", "qui", "c'est", "dit", "non"]]);
    expect(sentenceWords("A well-known fact.", "en")).toEqual([["A", "well-known", "fact"]]);
    // "Qu'il" never appears in lower case, so it is a name. Counted: est beau l'homme qui c'est dit non (7);
    // rare against est, qui, dit, non: beau l'homme c'est (3)
    const list: FrequencyList = { key: "test-fr", version: "1", forms: ["est", "qui", "dit", "non"] };
    expect(proseMetrics(text, { language: "fr", list, cutoff: 4 })?.rareWordShare).toBe(3 / 7);
    // Two tokens, one type
    expect(proseMetrics("l'homme l'homme", { language: "fr", window: 2 })?.mattr).toBe(1 / 2);
  });

  it("counts words with combining marks", () => {
    // Hindi: नमस्ते and दुनिया carry vowel signs and a virama, which are marks
    expect(proseMetrics("नमस्ते दुनिया", { language: "hi" })).toMatchObject({ sentenceCount: 1, meanSentenceWords: 2, mattr: 1 });
  });

  it("gives the same numbers twice", () => {
    const text = "Anna saw the river.\n\nThe river saw Anna, and a heron flew over the water.";
    const options = { language: "en", list: LIST, cutoff: 3, window: 4 };
    expect(proseMetrics(text, options)).toEqual(proseMetrics(text, options));
  });
});
