import { describe, expect, it } from "vitest";
import { matchQuote, normalizeQuoteText } from "@/lib/reader/engines/foliate/quote-match";

/* SLN-492: finding a saved place's text again when the file changed */

const text =
  "Des Esseintes had grown weary of the world. He withdrew to Fontenay, far from Paris. " +
  "There he arranged his house for himself alone. Later, in the dining room, he withdrew to Fontenay, far from Paris, again in thought.";

describe("matchQuote", () => {
  it("finds the passage exactly", () => {
    const at = text.indexOf("arranged his house");
    expect(matchQuote(text, { highlight: "arranged his house for himself" })).toMatchObject({ start: at, end: at + 30, score: 1 });
  });

  it("finds it despite a corrected typo and re-wrapped spaces", () => {
    const found = matchQuote(text, { highlight: "arangd his  house\nfor himself" });
    expect(found?.start).toBe(text.indexOf("arranged his house"));
    expect(found!.score).toBeLessThan(1);
  });

  it("finds it after a paragraph was inserted before it", () => {
    const quote = { before: "far from Paris. ", highlight: "There he arranged his house", after: " for himself alone." };
    const edited = "A new preface paragraph, added by the second edition's editor. " + text;
    expect(matchQuote(edited, quote, text.indexOf("There he"))?.start).toBe(edited.indexOf("There he arranged"));
  });

  it("uses the context to choose between two occurrences", () => {
    const second = text.lastIndexOf("he withdrew to Fontenay");
    expect(matchQuote(text, { before: "Later, in the dining room, ", highlight: "he withdrew to Fontenay", after: ", far from Paris, again" })?.start).toBe(second);
    const first = text.indexOf("He withdrew to Fontenay");
    expect(matchQuote(text, { before: "weary of the world. ", highlight: "He withdrew to Fontenay", after: ", far from Paris. There" })?.start).toBe(first);
  });

  it("takes the nearest of equal candidates to the hint", () => {
    const doubled = "the same words here. " + "x".repeat(200) + " the same words here.";
    const late = doubled.lastIndexOf("the same words");
    expect(matchQuote(doubled, { highlight: "the same words" }, late)?.start).toBe(late);
    expect(matchQuote(doubled, { highlight: "the same words" }, 0)?.start).toBe(0);
  });

  it("gives null for a passage that is not there or too short to place", () => {
    expect(matchQuote(text, { highlight: "a sentence from another book entirely" })).toBeNull();
    expect(matchQuote(text, { highlight: "He" })).toBeNull();
    expect(matchQuote(text, {})).toBeNull();
  });
});

describe("normalizeQuoteText", () => {
  it("reads any whitespace run as one space", () => {
    expect(normalizeQuoteText("a \n\t b  c")).toBe("a b c");
  });
});
