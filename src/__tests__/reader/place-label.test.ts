import { describe, expect, it } from "vitest";
import type { BookInfo } from "@/lib/reader/engine";
import {
  formatPercent,
  fractionPercent,
  locationWords,
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
  });
  it("treats a comic page heading beside its page as a repeat", () => {
    expect(samePlace("Page 3", "Page 3 of 6")).toBe(true);
    expect(samePlace("Page 1", "Page 10 of 12")).toBe(false);
    expect(samePlace("Chapter 1", "p. 8 of 200")).toBe(false);
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
      toc: [item("c1", "Chapter 1"), item("c1#b", "Part 2"), item("c2", "Chapter 2")],
      pageList: [item("c1#p8", "8"), item("c1#p9", "9"), item("c2#p12", "12")],
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
      "c1#p9": 0.21,
      c2: 0.5,
      "c2#p12": 0.5,
    });
    expect(index.entryPage("c1")?.label).toBe("8");
    expect(index.entryPage("c1#b")?.label).toBe("9");
    expect(index.entryPage("c2")?.label).toBe("12");
  });
});
