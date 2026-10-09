import { describe, it, expect } from "vitest";
import type {
  BookInfo,
  DurtalLocator,
  EngineEvents,
} from "@/lib/reader/engine";
import { PositionIndex, chapterTicks } from "@/lib/reader/position-index";
import { parseGoTo } from "@/lib/reader/goto";
import { PaceModel, formatTimeLeft } from "@/lib/reader/pace";
import {
  contrast,
  DEFAULT_RUNNING_POSITIONS,
  mutedInk,
  pageText,
  renderRunningLines,
  runningPositions,
} from "@/lib/reader/running-lines";
import {
  indexKey,
  readIndexCache,
  writeIndexCache,
} from "@/lib/reader/position-index-cache";
const item = (href: string, label: string) => ({ href, label, subitems: [] });
const info: BookInfo = {
  title: "Là-bas",
  authors: ["Huysmans"],
  language: "fr-FR",
  dir: "ltr",
  layout: "reflowable",
  locationCount: 10,
  linearSize: 15000,
  toc: [
    {
      ...item("a", "Préface"),
      subitems: [
        {
          ...item("a#one", "Chapitre I"),
          subitems: [item("a#equal", "Scene")],
        },
        item("a#two", "Chapitre II"),
      ],
    },
    item("b", "Chapitre III"),
    item("notes", "Notes"),
  ],
  pageList: [
    item("a", "iv"),
    item("a#one", "1"),
    item("a#two", "5"),
    item("b", "120"),
  ],
  sections: [
    { href: "a", label: "Section 1", linear: true, start: 0, end: 0.8 },
    { href: "b", label: "Section 2", linear: true, start: 0.8, end: 1 },
    { href: "notes", label: "Notes", linear: false, start: 1, end: 1 },
  ],
  capabilities: { search: true, tts: true, spreads: true, scrolled: true },
};
const index = () =>
  new PositionIndex(structuredClone(info), {
    "a#one": 0.2,
    "a#equal": 0.2,
    "a#two": 0.5,
    b: 0.8,
  });
const locator = (fraction = 0.5): DurtalLocator => ({
  v: 1,
  fileHash: "a".repeat(64),
  href: "a",
  sectionIndex: 0,
  progression: fraction / 0.8,
  totalProgression: fraction,
  position: 999,
});
const arrival = (
  fraction: number,
  overrides: Partial<EngineEvents["relocate"]> = {},
): EngineEvents["relocate"] => ({
  locator: locator(fraction),
  reason: "turn",
  chapter: null,
  atEnd: false,
  tocItem: null,
  visibleChars: 500,
  linear: true,
  paginated: true,
  ...overrides,
});
const storage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (n: number) => [...map.keys()][n] ?? null,
    get length() {
      return map.size;
    },
  };
};
describe("index and addresses", () => {
  it("flattens all depths, skips coincident chapters and excludes notes from stepping", () => {
    const positions = index();
    expect(positions.chapters).toHaveLength(5);
    expect(positions.nextChapter(0.2)?.href).toBe("a#two");
    expect(positions.chapterAt(0.7)?.label).toBe("Chapitre II");
    expect(positions.nextChapter(0.9)).toBeNull();
    expect(chapterTicks([0, 0.001, 0.02, 0.5, 0.5], 220)).toEqual([
      0, 0.02, 0.5,
    ]);
  });
  it("computes one-based labels independently of legacy position and projects notes", () => {
    expect(index().locationFor(locator(0))).toBe(1);
    expect(index().locationFor(locator(1))).toBe(10);
    expect(
      index().locationFor({
        ...locator(0.4),
        sectionIndex: 2,
        progression: 0.9,
      }),
    ).toBe(5);
    expect(index().preview(0.5)).toContain("p. 5");
  });
  it("validates page prefixes, Roman exact matches, preceding numeric pages and decimal percents", () => {
    const positions = index();
    expect(parseGoTo("page", "p. IV", positions)).toEqual({
      target: { href: "a" },
    });
    expect(parseGoTo("page", "page 7", positions)).toEqual({
      target: { href: "a#two" },
    });
    expect(parseGoTo("page", "iii", positions)).toHaveProperty("error");
    expect(parseGoTo("location", "0", positions)).toHaveProperty("error");
    expect(parseGoTo("location", "10", positions)).toEqual({
      target: { location: 10 },
    });
    expect(parseGoTo("percent", "12.5%", positions)).toEqual({
      target: { fraction: 0.125 },
    });
    expect(parseGoTo("percent", "101", positions)).toHaveProperty("error");
    expect(parseGoTo("chapter", "preface", positions)).toEqual({
      target: { href: "a" },
    });
  });
  it("falls back to linear section headings and persists only valid fractions with a 50-book LRU", () => {
    const fallback = new PositionIndex({ ...structuredClone(info), toc: [] });
    fallback.set("a", 0, "Le début");
    fallback.rebuild();
    expect(fallback.contents[0].label).toBe("Le début");
    expect(fallback.contents).toHaveLength(2);
    const local = storage();
    for (let n = 0; n < 51; n++)
      writeIndexCache(local, n.toString(16).padStart(64, "0"), { a: 0.2 });
    expect(local.getItem(indexKey("0".repeat(64)))).toBeNull();
    local.setItem(
      indexKey("a".repeat(64)),
      JSON.stringify({ v: 1, fractions: { a: 0.3, bad: 4, nan: "oops" } }),
    );
    expect(readIndexCache(local, "a".repeat(64))).toEqual({ a: 0.3 });
    expect(
      readIndexCache(
        {
          getItem() {
            throw Error();
          },
        } as unknown as Storage,
        "x",
      ),
    ).toEqual({});
  });
});
describe("device pace", () => {
  it("rejects layout and speech arrivals and discards their dwell before the next human turn", () => {
    for (const origin of ["layout", "speech"] as const) {
      let now = 0;
      const pace = new PaceModel(null, () => now);
      pace.arrive(arrival(0.1), "en");
      now = 10_000;
      expect(
        pace.arrive(
          arrival(0.5, {
            origin,
            reason: origin === "layout" ? "layout" : "turn",
          }),
          "en",
        ),
      ).toBe(false);
      now = 20_000;
      expect(pace.arrive(arrival(0.6), "en")).toBe(false);
      expect(pace.get("en")).toBeNull();
    }
  });
  it("learns only continuous eligible forward dwell, per primary language, using EMA .1", () => {
    const local = storage();
    let now = 0;
    const pace = new PaceModel(local, () => now);
    pace.arrive(arrival(0), "fr-FR");
    for (let n = 1; n <= 5; n++) {
      now += 10000;
      expect(pace.arrive(arrival(n / 20), "fr-FR")).toBe(true);
    }
    expect(pace.get("fr")?.samples).toBe(5);
    expect(pace.get("fr")?.cpm).toBe(3000);
    now += 20000;
    pace.arrive(arrival(0.3), "fr");
    expect(pace.get("fr")?.cpm).toBe(2850);
    expect(pace.remaining("en", 500, "book")).toBe("Learning your pace");
    expect(new PaceModel(local).get("fr-CA")?.samples).toBe(6);
  });
  it("rejects hidden, nonlinear, scrolled, fast, long, backward, jumped and interrupted samples", () => {
    for (const kind of [
      "hidden",
      "nonlinear",
      "scrolled",
      "fast",
      "long",
      "backward",
      "jump",
      "cancel",
      "reflow",
      "short",
    ]) {
      let now = 0;
      const pace = new PaceModel(null, () => now);
      pace.arrive(
        arrival(0.5, kind === "short" ? { visibleChars: 199 } : {}),
        "en",
      );
      if (["cancel", "reflow"].includes(kind)) pace.interrupt();
      now = kind === "fast" ? 4999 : kind === "long" ? 90001 : 10000;
      pace.arrive(
        arrival(kind === "backward" ? 0.4 : 0.6, {
          ...(kind === "nonlinear" ? { linear: false } : {}),
          ...(kind === "scrolled" ? { paginated: false } : {}),
          ...(kind === "jump" ? { reason: "jump" } : {}),
        }),
        "en",
        kind !== "hidden",
      );
      expect(pace.get("en"), kind).toBeNull();
    }
    expect(formatTimeLeft(0.3, "chapter")).toBe(
      "Less than a minute left in chapter",
    );
    expect(formatTimeLeft(80, "book")).toBe("1 h 20 min left in book");
  });
});
describe("running lines", () => {
  it("uses quiet but legible theme ink, print totals only for numeric labels, and local defaults", () => {
    const theme = { background: "#07090d", text: "#c5cacb" };
    expect(contrast(mutedInk(theme), theme.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(pageText({ ...locator(), pageLabel: "5" }, index())).toBe(
      "p. 5 of 120",
    );
    expect(pageText({ ...locator(), pageLabel: "iv" }, index())).toBe("p. iv");
    expect(runningPositions(null)).toEqual(DEFAULT_RUNNING_POSITIONS);
  });
  it("removes nonlinear estimates and suppresses book time when a plugin owns toolbar status", () => {
    const input = {
      positions: {
        ...DEFAULT_RUNNING_POSITIONS,
        timeLeftBook: "footerLeft" as const,
      },
      locator: locator(),
      index: index(),
      chapter: "Chapter",
      timeLeftChapter: "2 min left in chapter",
      timeLeftBook: "1 h left in book",
      clock: "12:00",
      linear: true,
      statusFilled: true,
      color: "#aaa",
    };
    expect(renderRunningLines(input).foot[0]).not.toContain("1 h");
    expect(renderRunningLines({ ...input, linear: false }).foot).toEqual([
      "",
      "Outside the reading order · 50%",
    ]);
  });
});
