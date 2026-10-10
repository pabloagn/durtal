// @vitest-environment happy-dom
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { FoliateDecorations } from "@/lib/reader/engines/foliate/decorations";
import { FoliateAnnotationResolver } from "@/lib/reader/engines/foliate/annotation-resolver";
import type { Decoration, DurtalLocator } from "@/lib/reader/engine";
import type {
  FoliateBook,
  FoliateView,
} from "@/lib/reader/engines/foliate/foliate";
import { decorationKey } from "@/lib/reader/decorations-index";

const hash = "a".repeat(64);
function setup(texts = ["Before chosen passage after.", "Second section."]) {
  const docs = texts.map((text) => {
    const doc = new Window().document as unknown as Document;
    doc.body.textContent = text;
    return doc;
  });
  const adds = docs.map(() => vi.fn());
  const removes = docs.map(() => vi.fn());
  const contents = docs.map((doc, index) => ({
    doc,
    index,
    overlayer: { add: adds[index], remove: removes[index] },
  }));
  const selection = (doc: Document, from: number, to: number) => {
    const range = doc.createRange();
    range.setStart(doc.body.firstChild!, from);
    range.setEnd(doc.body.firstChild!, to);
    return range;
  };
  const view = {
    renderer: { getContents: () => contents },
    resolveNavigation: vi.fn((cfi: string) => {
      const [index, start, end] = cfi.split(":").map(Number);
      if (!docs[index] || !Number.isFinite(start) || !Number.isFinite(end))
        return undefined;
      return { index, anchor: (doc: Document) => selection(doc, start, end) };
    }),
    getCFI: (index: number, range: Range) =>
      `${index}:${range.startOffset}:${range.endOffset}`,
    getProgressOf: () => ({ tocItem: { label: "Chapter" } }),
    getSectionFractions: () => [0, 0.5],
  } as unknown as FoliateView;
  const book: FoliateBook = {
    sections: docs.map((doc, index) => ({
      id: `chapter-${index}`,
      size: texts[index].length,
      createDocument: async () => doc,
    })),
    resolveHref: () => null,
  };
  const locator = (cfi = "0:7:21"): DurtalLocator => ({
    v: 1,
    fileHash: hash,
    href: "chapter-0",
    sectionIndex: 0,
    progression: 0.2,
    totalProgression: 0.1,
    cfi,
    text: { highlight: "chosen passage" },
  });
  const mark = (id = "mark"): Decoration => ({
    id,
    locator: locator(),
    style: "highlight",
    color: "#afa184",
  });
  return { docs, contents, adds, removes, view, book, locator, mark };
}
const drawing = {
  highlight: vi.fn(() =>
    document.createElementNS("http://www.w3.org/2000/svg", "g"),
  ),
  underline: vi.fn(() =>
    document.createElementNS("http://www.w3.org/2000/svg", "g"),
  ),
  outline: vi.fn(() =>
    document.createElementNS("http://www.w3.org/2000/svg", "g"),
  ),
};
describe("actual adapter decorations", () => {
  it("diffs a group without removing another mark at the same CFI and draws only loaded sections", () => {
    const s = setup(),
      marks = new FoliateDecorations(drawing);
    marks.set(s.view, hash, "annotations", [s.mark()]);
    marks.set(s.view, hash, "history", [{ cfi: "0:7:21", color: "#8c9fae" }]);
    marks.set(s.view, hash, "search", [
      { ...s.mark("search"), color: "#a3ae9c" },
    ]);
    expect(s.adds[0]).toHaveBeenCalledTimes(3);
    expect(s.adds[1]).not.toHaveBeenCalled();
    marks.set(s.view, hash, "annotations", [s.mark()]);
    expect(s.adds[0]).toHaveBeenCalledTimes(3);
    marks.set(s.view, hash, "annotations", []);
    expect(s.removes[0]).toHaveBeenCalledExactlyOnceWith(
      decorationKey("annotations", "mark"),
    );
    expect(marks.hit(s.view, decorationKey("search", "search"), 0)?.group).toBe(
      "search",
    );
  });
  it("refuses a wrong file and a CFI that does not quote the whole selected passage", () => {
    const s = setup(),
      marks = new FoliateDecorations(drawing),
      selected = s.mark();
    if (!("locator" in selected)) throw new Error("fixture");
    marks.set(s.view, hash, "annotations", [
      {
        ...selected,
        locator: { ...selected.locator, fileHash: "b".repeat(64) },
      },
    ]);
    marks.set(s.view, hash, "annotations", [
      { ...selected, locator: s.locator("0:0:6") },
    ]);
    expect(s.adds[0]).not.toHaveBeenCalled();
  });
  it("reinstalls marks into a rebuilt overlayer, preserving quote drawing as two thin lines", () => {
    const s = setup(),
      marks = new FoliateDecorations(drawing),
      selected = s.mark();
    if (!("locator" in selected)) throw new Error("fixture");
    marks.set(s.view, hash, "annotations", [{ ...selected, style: "quote" }]);
    const draw = s.adds[0].mock.calls[0][2];
    drawing.underline.mockClear();
    draw([{ left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20 }]);
    expect(drawing.underline.mock.calls).toEqual([
      [
        expect.any(Array),
        {
          color: "#afa184",
          width: 1,
          padding: 0,
          writingMode: "horizontal-tb",
        },
      ],
      [
        expect.any(Array),
        {
          color: "#afa184",
          width: 1,
          padding: 3,
          writingMode: "horizontal-tb",
        },
      ],
    ]);
    const rebuilt = vi.fn();
    s.contents[0].overlayer = { add: rebuilt, remove: vi.fn() };
    marks.render(s.view);
    expect(rebuilt).toHaveBeenCalledOnce();
  });
});
describe("strict adapter annotation resolution", () => {
  it("verifies the full CFI range without navigation and heals stale CFIs by the passage", async () => {
    const s = setup(),
      resolver = new FoliateAnnotationResolver(s.book, s.view, hash, () => 0.4);
    expect(
      await resolver.resolve({ kind: "highlight", locator: s.locator() }),
    ).toEqual({ status: "exact", locator: s.locator() });
    const healed = await resolver.resolve({
      kind: "highlight",
      locator: s.locator("0:0:6"),
    });
    expect(healed.status).toBe("healed");
    expect(healed.locator?.cfi).toBe("0:7:21");
    expect(healed.locator?.text?.highlight).toBe("chosen passage");
  });
  it("heals into the preferred href after a file replacement and refuses missing or ambiguous passage text", async () => {
    const s = setup([
        "Inserted paragraph. Before chosen passage after.",
        "Nothing.",
      ]),
      resolver = new FoliateAnnotationResolver(s.book, s.view, hash, () => 0.4);
    const old = { ...s.locator(), fileHash: "b".repeat(64) };
    const healed = await resolver.resolve({ kind: "highlight", locator: old });
    expect(healed.status).toBe("healed");
    expect(healed.locator?.fileHash).toBe(hash);
    const missing = setup(["Unrelated material", "Unrelated again"]);
    expect(
      await new FoliateAnnotationResolver(
        missing.book,
        missing.view,
        hash,
        () => 0,
      ).resolve({ kind: "highlight", locator: old }),
    ).toEqual({ status: "orphaned", locator: null });
    const duplicate = setup(["chosen passage and chosen passage", "Nothing"]);
    expect(
      await new FoliateAnnotationResolver(
        duplicate.book,
        duplicate.view,
        hash,
        () => 0,
      ).resolve({ kind: "highlight", locator: old }),
    ).toEqual({ status: "orphaned", locator: null });
  });
  it("keeps cancellation pending and never substitutes a fraction for a missing highlight", async () => {
    const s = setup(),
      resolver = new FoliateAnnotationResolver(s.book, s.view, hash, () => 0.4);
    const abort = new AbortController();
    abort.abort();
    expect(
      await resolver.resolve(
        { kind: "highlight", locator: s.locator() },
        { signal: abort.signal },
      ),
    ).toEqual({ status: "pending", locator: null });
    const bookmark = await resolver.resolve({
      kind: "bookmark",
      locator: { ...s.locator(), cfi: undefined, text: undefined },
    });
    expect(bookmark.status).toBe("approximate");
    expect(bookmark.locator?.cfi).toBeUndefined();
    resolver.destroy();
    expect(
      (await resolver.resolve({ kind: "highlight", locator: s.locator() }))
        .status,
    ).toBe("pending");
  });
});
