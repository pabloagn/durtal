import { describe, expect, it } from "vitest";
import { PositionIndex } from "@/lib/reader/position-index";
import type { BookInfo } from "@/lib/reader/engine";

const fixture = (): BookInfo => ({
  title: "Long contents", authors: [], language: "en", dir: "ltr", layout: "reflowable",
  locationCount: 2000, linearSize: 30000, pageList: [],
  sections: Array.from({ length: 100 }, (_, index) => ({ href: String(index), label: String(index),
    linear: true, start: index / 100, end: (index + 1) / 100 })),
  toc: Array.from({ length: 100 }, (_, section) => ({ href: String(section), label: String(section),
    subitems: Array.from({ length: 20 }, (_, anchor) => ({ href: `${section}#a${anchor}`, label: String(anchor), subitems: [] })) })),
  capabilities: { search: true, tts: true, spreads: true, scrolled: true },
});

describe("weighted long contents index", () => {
  it("preserves exact original weighted totals, fractions and completeness for repeated section anchors and changed ratios", () => {
    const info = fixture(), index = new PositionIndex(info), ratios = new Map<string, number>();
    for (let section = 0; section < 100; section++) {
      const ratio = (section % 7) / 6;
      ratios.set(String(section), ratio);
      const expected = info.sections.reduce((sum, item) => sum +
        (item.end - item.start) * (ratios.get(item.href) ?? 0.5), 0);
      for (let anchor = -1; anchor < 20; anchor++) {
        const href = anchor < 0 ? String(section) : `${section}#a${anchor}`;
        const fraction = section / 100 + Math.max(0, anchor) / 2000;
        index.set(href, fraction, `Chapter ${section}`, ratio);
        expect(index.textRatio).toBe(expected);
        expect(index.fraction(href)).toBe(fraction);
        expect(index.sectionFor(href)).toBe(info.sections[section]);
      }
    }
    expect(index.complete).toBe(true);
    ratios.set("0", 0.9);
    index.set("0#a0", 0, "Updated", 0.9);
    expect(index.textRatio).toBe(info.sections.reduce((sum, item) => sum +
      (item.end - item.start) * (ratios.get(item.href) ?? 0.5), 0));
    index.rebuild();
    expect(index.chapters).toHaveLength(2100);
    expect(index.chapterAt(0)?.label).toBeDefined();
  });
  it("keeps explicit TOC section bindings and the first duplicate section href", () => {
    const info = fixture();
    info.sections.push({ ...info.sections[0], label: "duplicate" });
    info.toc.push({ href: "bound", label: "Explicit", sectionIndex: 1, subitems: [] });
    const index = new PositionIndex(info);
    expect(index.sectionFor("0#anchor")).toBe(info.sections[0]);
    expect(index.sectionFor("bound")).toBe(info.sections[1]);
    expect(index.sectionFor("missing")).toBeUndefined();
  });
});
