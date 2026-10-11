import { describe, expect, it } from "vitest";
import {
  matchAnnotationQuote,
  findAnnotationQuote,
  annotationAnchorState,
} from "@/lib/reader/engines/foliate/annotation-anchor";

describe("conservative annotation quote matching", () => {
  it("returns the whole raw passage after insertion and whitespace reflow", () => {
    const raw = "Inserted paragraph. Before. The\n quiet  glass. After.";
    const result = matchAnnotationQuote(raw, {
      highlight: "The quiet glass.",
      before: "Before. ",
      after: " After.",
    });
    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("No range");
    expect(raw.slice(result.match.start, result.match.end)).toBe(
      "The\n quiet  glass.",
    );
    expect(result.match.end).toBeGreaterThan(result.match.start);
  });
  it("heals a typo only when the passage and context meet 0.85", () => {
    const result = matchAnnotationQuote("Before. The quiet glasp. After.", {
      highlight: "The quiet glass.",
      before: "Before. ",
      after: " After.",
    });
    expect(result.status).toBe("found");
    if (result.status === "found")
      expect(result.match.passageScore).toBeGreaterThanOrEqual(0.85);
    expect(
      matchAnnotationQuote("The loud smoke.", { highlight: "The quiet glass." })
        .status,
    ).toBe("missing");
  });
  it("does not use proximity to paint an ambiguous repetition", () => {
    expect(
      matchAnnotationQuote("same phrase / same phrase", {
        highlight: "same phrase",
      }).status,
    ).toBe("ambiguous");
    expect(
      matchAnnotationQuote("A same phrase X. B same phrase Y.", {
        highlight: "same phrase",
        before: "B ",
        after: " Y.",
      }).status,
    ).toBe("found");
  });
  it("uses exact matching for short and Unicode quotes", () => {
    expect(
      matchAnnotationQuote("a 🙂 b", {
        highlight: "🙂",
        before: "a ",
        after: " b",
      }),
    ).toMatchObject({ status: "found", match: { start: 2, end: 4 } });
    expect(
      matchAnnotationQuote("x a y", {
        highlight: "a",
        before: "x ",
        after: " y",
      }).status,
    ).toBe("found");
  });
  it("prefers the original href and searches other sections without arbitrary ties", () => {
    const sections = [
      { href: "a", sectionIndex: 0, text: "target passage" },
      { href: "b", sectionIndex: 1, text: "target passage" },
    ];
    expect(
      findAnnotationQuote(sections, { highlight: "target passage" }, "b"),
    ).toMatchObject({ status: "found", href: "b", sectionIndex: 1 });
    expect(
      findAnnotationQuote(sections, { highlight: "target passage" }, "missing")
        .status,
    ).toBe("ambiguous");
  });
  it("reports budget exhaustion and cancellation as pending, never missing", () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      matchAnnotationQuote(
        "target passage",
        { highlight: "target passage" },
        { signal: controller.signal },
      ).status,
    ).toBe("deferred");
    expect(
      matchAnnotationQuote(
        "x".repeat(500),
        { highlight: "target passage" },
        { maxWork: 100 },
      ).status,
    ).toBe("deferred");
    expect(
      findAnnotationQuote(
        [
          { href: "a", sectionIndex: 0, text: "x".repeat(60) },
          { href: "b", sectionIndex: 1, text: "x".repeat(60) },
        ],
        { highlight: "target" },
        "old",
        { maxWork: 100 },
      ).status,
    ).toBe("deferred");
  });
  it("charges fuzzy and context work to one shared cross-section budget", () => {
    const sections = [
      { href: "a", sectionIndex: 0, text: "The quiet glasp." },
      { href: "b", sectionIndex: 1, text: "The quiet glasp." },
    ];
    expect(
      matchAnnotationQuote(
        sections[0].text,
        { highlight: "The quiet glass." },
        { maxWork: 6_000 },
      ).status,
    ).toBe("found");
    expect(
      findAnnotationQuote(sections, { highlight: "The quiet glass." }, "old", {
        maxWork: 6_000,
      }).status,
    ).toBe("deferred");
    expect(
      matchAnnotationQuote(
        "x target y",
        { highlight: "target", before: "x".repeat(64), after: "y".repeat(64) },
        { maxWork: 100 },
      ).status,
    ).toBe("deferred");
  });
  it("keeps missing highlights orphaned and approximate anchors out of filled text", () => {
    const base = {
      kind: "highlight" as const,
      exactRangeVerified: false,
      fractionAvailable: true,
    };
    expect(annotationAnchorState({ ...base, quote: "missing" })).toBe(
      "orphaned",
    );
    expect(annotationAnchorState({ ...base, quote: "ambiguous" })).toBe(
      "orphaned",
    );
    expect(annotationAnchorState({ ...base, quote: "deferred" })).toBe(
      "pending",
    );
    expect(annotationAnchorState({ ...base, quote: "unavailable" })).toBe(
      "approximate",
    );
    expect(
      annotationAnchorState({ ...base, quote: "missing", kind: "bookmark" }),
    ).toBe("approximate");
  });
});
