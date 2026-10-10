import { describe, expect, it } from "vitest";
import {
  excludeSpeechNode,
  firstSpeechSentence,
  speechText,
  speechBlockLanguage,
  speechSectionIsLinear,
  SPEECH_MOVEMENT_POLICY,
} from "@/lib/reader/speech/segmentation-policy";
import {
  sameSpeechToken,
  nextSpeechGeneration,
} from "@/lib/reader/speech/cancellation";
const spans = [
  { start: 0, end: 12 },
  { start: 14, end: 30 },
  { start: 30, end: 50 },
];

describe("speech segmentation and cancellation policies", () => {
  it("starts in the containing sentence, at the next in a gap, and not beyond EOF", () => {
    expect(firstSpeechSentence(spans, { kind: "locator", offset: 4 })).toBe(0);
    expect(firstSpeechSentence(spans, { kind: "locator", offset: 12 })).toBe(1);
    expect(firstSpeechSentence(spans, { kind: "locator", offset: 30 })).toBe(2);
    expect(
      firstSpeechSentence(spans, { kind: "locator", offset: 50 }),
    ).toBeNull();
  });
  it("starts at the first intersecting visible sentence, excluding a preceding boundary", () => {
    expect(
      firstSpeechSentence(spans, { kind: "visible", start: 20, end: 40 }),
    ).toBe(1);
    expect(
      firstSpeechSentence(spans, { kind: "visible", start: 30, end: 45 }),
    ).toBe(2);
    expect(
      firstSpeechSentence(spans, { kind: "visible", start: 12, end: 14 }),
    ).toBeNull();
  });
  it("uses an iterable without consuming every following sentence", () => {
    function* sentences() {
      yield spans[0];
      yield spans[1];
      throw new Error("unbounded lookahead");
    }
    expect(
      firstSpeechSentence(sentences(), { kind: "locator", offset: 20 }),
    ).toBe(1);
  });
  it("rejects invalid start locations and malformed spans", () => {
    expect(
      firstSpeechSentence(spans, { kind: "locator", offset: NaN }),
    ).toBeNull();
    expect(
      firstSpeechSentence(spans, { kind: "locator", offset: -1 }),
    ).toBeNull();
    expect(
      firstSpeechSentence(spans, { kind: "visible", start: 1, end: Infinity }),
    ).toBeNull();
    expect(
      firstSpeechSentence(spans, { kind: "visible", start: 1, end: 1 }),
    ).toBeNull();
    expect(
      firstSpeechSentence([{ start: NaN, end: Infinity }, ...spans], {
        kind: "locator",
        offset: 4,
      }),
    ).toBe(1);
  });
  it.each(["footnote", "endnote", "rearnote", "pagebreak"])(
    "rejects the %s EPUB token inside a token list",
    (type) => {
      expect(
        excludeSpeechNode({ tag: "span", epubTypes: `other ${type} other` }),
      ).toBe(true);
    },
  );
  it.each(["doc-noteref", "doc-footnote", "doc-endnote", "doc-pagebreak"])(
    "rejects semantic role %s",
    (role) => {
      expect(excludeSpeechNode({ tag: "a", role })).toBe(true);
    },
  );
  it.each(["rt", "rp", "script", "style"])("rejects %s content", (tag) => {
    expect(excludeSpeechNode({ tag: tag.toUpperCase() })).toBe(true);
  });
  it("rejects shared note references and referenced asides, not all asides/captions/ruby bases", () => {
    expect(excludeSpeechNode({ tag: "a", noteReference: true })).toBe(true);
    expect(excludeSpeechNode({ tag: "aside", referencedNoteAside: true })).toBe(
      true,
    );
    expect(excludeSpeechNode({ tag: "em", rejectedAncestor: true })).toBe(true);
    for (const tag of ["aside", "figcaption", "ruby", "p"])
      expect(excludeSpeechNode({ tag })).toBe(false);
  });
  it("assembles accepted text without reintroducing excluded inline ranges", () => {
    expect(
      speechText([
        { text: "Read this", excluded: false },
        { text: " 139 footnote", excluded: true },
        { text: ".\nNext sentence.", excluded: false },
      ]),
    ).toBe("Read this. Next sentence.");
  });
  it("inherits nearest valid language including xml:lang and falls back to book/und", () => {
    expect(speechBlockLanguage([{ xmlLang: "fr" }, { lang: "en" }], "en")).toBe(
      "fr",
    );
    expect(
      speechBlockLanguage([{ lang: "not_valid" }, { lang: "ja" }], "en"),
    ).toBe("ja");
    expect(speechBlockLanguage([], "EN-gb")).toBe("en-GB");
    expect(speechBlockLanguage([], null)).toBe("und");
    expect(speechSectionIsLinear("no")).toBe(false);
    expect(speechSectionIsLinear(undefined)).toBe(true);
  });
  it("automatic speech saves progress but never supplies human activity, pace or completion confirmation", () => {
    expect(SPEECH_MOVEMENT_POLICY).toEqual({
      origin: "speech",
      savePosition: true,
      humanActivity: false,
      samplePace: false,
      confirmCompletion: false,
    });
    expect(Object.isFrozen(SPEECH_MOVEMENT_POLICY)).toBe(true);
  });
  it("invalidating a generation rejects old callbacks even when their sequence matches", () => {
    const old = { generation: 1, utterance: 2 };
    const current = {
      generation: nextSpeechGeneration(old.generation),
      utterance: 2,
    };
    expect(sameSpeechToken(current, old)).toBe(false);
    expect(sameSpeechToken(current, { ...current })).toBe(true);
    expect(sameSpeechToken(current, { ...current, utterance: 3 })).toBe(false);
    expect(sameSpeechToken(null, old)).toBe(false);
    expect(() => nextSpeechGeneration(Number.MAX_SAFE_INTEGER)).toThrow(
      RangeError,
    );
  });
});
