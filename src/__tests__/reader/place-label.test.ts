import { describe, expect, it } from "vitest";
import type { BookInfo } from "@/lib/reader/engine";
import {
  formatPercent,
  fractionPercent,
  locationWords,
  pageRangeWords,
  pageWords,
  samePlace,
} from "@/lib/reader/place-label";
import { PositionIndex } from "@/lib/reader/position-index";

const item = (href: string, label: string) => ({ href, label, subitems: [] });

describe("place labels (SLN-680)", () => {
  it("writes one percent format everywhere, never finished early", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(7.77)).toBe("7.7%");
    expect(formatPercent(7)).toBe("7%");
    expect(formatPercent(56.99999999)).toBe("57%");
    expect(formatPercent(99.9)).toBe("99%");
    expect(formatPercent(140)).toBe("100%");
    expect(formatPercent(Number.NaN)).toBe("0%");
    expect(fractionPercent(0.5)).toBe("50%");
  });
  it("names pages and locations with their totals", () => {
    expect(pageWords("7", "32")).toBe("p. 7 of 32");
    expect(pageWords("iv", "32")).toBe("p. iv");
    expect(pageWords("3", "6", true)).toBe("Page 3 of 6");
    expect(locationWords(6, 16)).toBe("Location 6 of 16");
    expect(pageRangeWords("8", "9", "32")).toBe("pp. 8–9 of 32");
    expect(pageRangeWords("iv", "v", "32")).toBe("pp. iv–v");
    expect(pageRangeWords("1", "2", "6", true)).toBe("Pages 1–2 of 6");
    expect(pageRangeWords("7", "7", "32")).toBe("p. 7 of 32");
  });
  it("treats a comic page heading beside its page as a repeat", () => {
    expect(samePlace("Page 3", "Page 3 of 6")).toBe(true);
    expect(samePlace("Page 1", "Page 10 of 12")).toBe(false);
    expect(samePlace("Chapter 1", "p. 8 of 200")).toBe(false);
    expect(samePlace("Page 1", "Pages 1–2 of 6")).toBe(true);
    expect(samePlace("Page 1", "Pages 10–11 of 12")).toBe(false);
  });
  it("gives a chapter the page it starts on, not the page before it", () => {
    // Chapter 1's parts start just before the next page marker: every part
    // used to say the page the marker before them named.
    const info: BookInfo = {
      title: "Test",
      authors: [],
      language: "en",
      dir: "ltr",
      layout: "reflowable",
      locationCount: 10,
      linearSize: 15000,
      toc: [item("c1", "Chapter 1"), item("c1#b", "Part 2"), item("c1#c", "Part 3"), item("c2", "Chapter 2")],
      pageList: [item("c1#p8", "8"), item("c1#p9", "9"), item("c1#p10", "10"), item("c2#p12", "12")],
      sections: [
        { href: "c1", label: "1", linear: true, start: 0, end: 0.5 },
        { href: "c2", label: "2", linear: true, start: 0.5, end: 1 },
      ],
      capabilities: { search: true, tts: true, spreads: true, scrolled: true },
    };
    const index = new PositionIndex(info, {
      c1: 0,
      "c1#p8": 0.01,
      "c1#b": 0.2,
      "c1#p9": 0.205,
      "c1#c": 0.3,
      "c1#p10": 0.35,
      c2: 0.5,
      // A section's first marker comes after the file's head
      "c2#p12": 0.55,
    });
    expect(index.entryPage("c1")?.label).toBe("8");
    expect(index.entryPage("c1#b")?.label).toBe("9");
    // A marker 750 characters on belongs to the text before it
    expect(index.entryPage("c1#c")?.label).toBe("9");
    expect(index.entryPage("c2")?.label).toBe("12");
    // A screen is named by the pages it shows, the first by the contents' rule
    const at = (sectionIndex: number, progression: number, totalProgression: number) =>
      index.locatorLabel({ v: 1, fileHash: "a".repeat(64), href: "c", sectionIndex, progression, totalProgression });
    expect(at(0, 0, 0.1)).toBe("p. 8 of 12");
    expect(at(0, 0.4, 0.3)).toBe("p. 9 of 12");
    expect(at(0, 0, 0.3)).toBe("pp. 8–9 of 12");
    expect(at(1, 0, 0.6)).toBe("p. 12 of 12");
    // The engine's last visible marker counts when the layout's end falls short
    expect(index.locatorLabel({ v: 1, fileHash: "a".repeat(64), href: "c", sectionIndex: 0, progression: 0,
      totalProgression: 0.1, pageLabel: "9" })).toBe("pp. 8–9 of 12");
  });
});

describe("contents pages before the book is indexed (SLN-724)", () => {
  const info: BookInfo = {
    title: "Test",
    authors: [],
    language: "en",
    dir: "ltr",
    layout: "reflowable",
    locationCount: 10,
    linearSize: 15000,
    toc: [item("c1", "Chapter 1"), item("c1#b", "Part 2"), item("c2", "Chapter 2"), item("c2#b", "Part 2")],
    pageList: [item("c1#p1", "1"), item("c1#p4", "4"), item("c2#p8", "8"), item("c2#p11", "11")],
    sections: [
      { href: "c1", label: "1", linear: true, start: 0, end: 0.5 },
      { href: "c2", label: "2", linear: true, start: 0.5, end: 1 },
    ],
    capabilities: { search: true, tts: true, spreads: true, scrolled: true },
  };
  it("names no page for an entry whose section is not placed yet, then the right one", () => {
    // Every anchor unplaced stands at its section's start: each entry used to
    // get its section's last page (Chapter 1 and its parts all "4")
    const index = new PositionIndex(info);
    for (const href of ["c1", "c1#b", "c2", "c2#b"]) expect(index.entryPage(href)).toBeNull();
    expect(index.placed("c1")).toBe(true);
    expect(index.placed("c1#b")).toBe(false);
    // The first section placed, the second not
    for (const [href, fraction] of [["c1#p1", 0.01], ["c1#b", 0.2], ["c1#p4", 0.205]] as const) index.set(href, fraction);
    index.rebuild();
    expect(index.entryPage("c1")?.label).toBe("1");
    expect(index.entryPage("c1#b")?.label).toBe("4");
    expect(index.entryPage("c2")).toBeNull();
    for (const [href, fraction] of [["c2#p8", 0.51], ["c2#b", 0.7], ["c2#p11", 0.705]] as const) index.set(href, fraction);
    index.rebuild();
    expect(index.entryPage("c2")?.label).toBe("8");
    expect(index.entryPage("c2#b")?.label).toBe("11");
  });
});
