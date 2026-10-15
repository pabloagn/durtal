// @vitest-environment happy-dom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  FoliateBook,
  FoliateProgress,
} from "@/lib/reader/engines/foliate/foliate";
const fixtures = vi.hoisted(() => ({
  book: null as FoliateBook | null,
  loadText: vi.fn(
    async () => '<page-map><page name="xii" href="a#p12"/></page-map>',
  ),
}));
vi.mock("@/vendor/foliate-js/vendor/zip.js", () => ({}));
vi.mock("@/lib/reader/engines/foliate/zip-reader", () => ({
  makeRangeZipLoader: async () => ({
    entries: [],
    loadText: fixtures.loadText,
  }),
}));
vi.mock("@/vendor/foliate-js/epub.js", () => ({
  EPUB: class {
    async init() {
      return (
        fixtures.book ?? {
          sections: [{ id: "chapter", size: 100, linear: "yes" }],
          metadata: { title: "Test" },
          resolveHref: () => ({ index: 0 }),
        }
      );
    }
  },
}));
vi.mock("@/vendor/foliate-js/view.js", () => ({}));
vi.mock("@/lib/reader/engines/foliate/comic-book", () => ({
  makeDurtalComicBook: async () => fixtures.book,
}));
import { createFoliateEngine } from "@/lib/reader/engines/foliate/engine";
import { createReaderNavigation } from "@/lib/reader/navigation";
import { parseGoTo } from "@/lib/reader/goto";
import { PositionIndex } from "@/lib/reader/position-index";
import { PaceModel } from "@/lib/reader/pace";
import { resolveContinueAnchor } from "@/lib/ebooks/continue-resolve";
import type { BookInfo, ReaderEngine } from "@/lib/reader/engine";
import {
  presentationFrom,
  resolveThemeColors,
} from "@/lib/reader/presentation";
import { READER_DEFAULTS } from "@/lib/reader/settings-cookie";

class TestView extends HTMLElement {
  frame = document.createElement("iframe");
  renderer = Object.assign(document.createElement("div"), {
    atEnd: false,
    getContents: () => [{ doc: this.frame.contentDocument!, index: 0 }],
    setStyles() {},
    goTo: async (target: { index: number; anchor?: unknown }) => {
      this.renderer.atEnd = target.anchor === 1;
      this.report("anchor", target.anchor === 1 ? 1 : 0, target.index);
    },
  });
  lastLocation: FoliateProgress | null = null;
  async open() {
    this.append(this.renderer);
    this.renderer.append(this.frame);
    this.frame.contentDocument!.body.innerHTML =
      "<p>Before the selection. A long selected passage that contains more than sixty-four characters and continues for another sentence. After the selection.</p>";
    this.dispatchEvent(
      new CustomEvent("load", {
        detail: { doc: this.frame.contentDocument, index: 0 },
      }),
    );
  }
  report(
    reason: string,
    fraction = 0.4,
    index = 0,
    range: Range | null = null,
    sectionFraction = fraction,
  ) {
    this.lastLocation = {
      reason,
      fraction,
      index,
      sectionFraction,
      cfi: "cfi" + fraction,
      range,
    };
    this.dispatchEvent(
      new CustomEvent("relocate", {
        detail: this.lastLocation,
      }),
    );
  }
  async init() {
    this.report("page", 0);
  }
  async goTo() {
    this.report("anchor", 0.6);
  }
  async goToFraction(fraction: number) {
    this.report("anchor", fraction);
  }
  async next() {
    this.report("page", 0.5);
  }
  async prev() {
    this.report("page", 0.3);
  }
  async goLeft() {
    await this.prev();
  }
  async goRight() {
    await this.next();
  }
  getSectionFractions() {
    return [0, 0.5, 1];
  }
  getCFI(_index?: number, _range?: Range) {
    void _index;
    void _range;
    return "epubcfi(selection)";
  }
  getProgressOf() {
    return {
      tocItem: { label: "Selected chapter" },
      pageItem: { label: "xii" },
    };
  }
  resolveNavigation(target?: unknown): {
    index: number;
    anchor?: (doc: Document) => Range | Element;
  } {
    return {
      index:
        target === "notes-cfi" ? 2 : typeof target === "number" ? target : 0,
    };
  }
  close() {}
}
let host: HTMLElement, engine: ReaderEngine, view: TestView;
beforeAll(() => {
  if (!customElements.get("foliate-view"))
    customElements.define("foliate-view", TestView);
});
beforeEach(async () => {
  fixtures.book = null;
  fixtures.loadText.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  engine = createFoliateEngine();
  await engine.open(
    {
      ebookId: "book",
      fileId: "epub",
      format: "epub",
      size: 1000,
      sha256: "a".repeat(64),
      url: "/unused",
      fallbackUrl: "/unused",
    },
    {
      container: host,
      presentation: presentationFrom(READER_DEFAULTS, resolveThemeColors(), ""),
    },
  );
  view = host.querySelector("foliate-view") as TestView;
});
afterEach(() => {
  engine.destroy();
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("foliate bridge adapter", () => {
  it("heals a historical quote after inserted paragraphs through the actual adapter and reports its observed landing", async () => {
    engine.destroy();
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML =
      "<p>A newly inserted paragraph.</p><p>Context The paragraph I was reading following.</p>";
    fixtures.book = {
      sections: [
        {
          id: "chapter",
          size: 500,
          linear: "yes",
          createDocument: async () => doc,
        },
      ],
      metadata: { title: "Replacement" },
      resolveHref: () => ({ index: 0 }),
    };
    engine = createFoliateEngine();
    await engine.open(
      {
        ebookId: "book",
        fileId: "epub",
        format: "epub",
        size: 1000,
        sha256: "a".repeat(64),
        url: "/unused",
        fallbackUrl: "/unused",
      },
      {
        container: host,
        presentation: presentationFrom(
          READER_DEFAULTS,
          resolveThemeColors(),
          "",
        ),
      },
    );
    view = host.querySelector("foliate-view") as TestView;
    const cfi = vi.spyOn(view, "getCFI");
    vi.spyOn(view.renderer, "goTo").mockImplementation(async (target) => {
      view.report("anchor", 0.6, target.index);
    });
    const locator = {
      v: 1 as const,
      fileHash: "b".repeat(64),
      href: "chapter",
      sectionIndex: 0,
      progression: 0.4,
      totalProgression: 0.44,
      cfi: "epubcfi(obsolete)",
      text: {
        before: "Context ",
        highlight: "The paragraph I was reading",
        after: " following.",
      },
    };
    const result = await resolveContinueAnchor(
      {
        target: { id: "epub", sha256: "a".repeat(64) },
        anchor: {
          deviceId: "local",
          deviceLabel: "Mac",
          fileId: "replaced",
          chapter: null,
          clientUpdatedAt: "2026-10-09T10:00:00Z",
          locator,
        },
      },
      engine,
    );
    expect(result).toMatchObject({
      status: "healed",
      percent: 60,
      sourceFileId: "replaced",
      sourceHash: "b".repeat(64),
      targetFileId: "epub",
      clientUpdatedAt: "2026-10-09T10:00:00Z",
    });
    expect(cfi.mock.calls[0][1]?.startContainer.textContent).toContain(
      "The paragraph I was reading",
    );
    expect(result?.locator.fileHash).toBe("a".repeat(64));
    expect(locator.cfi).toBe("epubcfi(obsolete)");
  });
  it("keeps owned boundary navigation a turn while unowned navigation and reflow remain layout", async () => {
    const seen = vi.fn();
    engine.on("relocate", seen);
    vi.spyOn(view, "next").mockImplementation(async () => {
      view.report("navigation", 0.6);
    });
    await engine.next({ id: 81, signal: new AbortController().signal });
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reason: "turn",
        origin: "human",
        navigationId: 81,
        activity: "turn",
      }),
    );
    expect(engine.currentLocator()?.totalProgression).toBe(0.6);
    view.report("navigation", 0.8);
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reason: "layout",
        origin: "layout",
        atEnd: false,
        navigationId: undefined,
        activity: undefined,
      }),
    );
    expect(engine.currentLocator()?.totalProgression).toBe(0.6);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(view.next).mockImplementationOnce(async () => {
      view.report("anchor", 0.9);
      await pending;
    });
    const turn = engine.next({ id: 82, signal: new AbortController().signal });
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reason: "layout",
        origin: "layout",
        navigationId: 82,
        activity: undefined,
      }),
    );
    expect(engine.currentLocator()?.totalProgression).toBe(0.6);
    finish();
    await turn;
  });
  it("commits forward/backward section-boundary turns after paint without recovery or extra history steps", async () => {
    await withNotes();
    const doc = view.frame.contentDocument!;
    doc.body.innerHTML = "<p>" + "a".repeat(300) + "</p>";
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const raw = vi.fn();
    const offRaw = engine.on("relocate", raw);
    view.report("page", 0.3, 0, range, 0.75);
    let now = 0,
      finishPaint!: () => void,
      firstPaint = true;
    const pace = new PaceModel(null, () => now);
    const start = raw.mock.calls.at(-1)![0];
    pace.arrive(start, "en");
    const barrier = new Promise<void>((resolve) => {
      finishPaint = resolve;
    });
    const commit = vi.fn((relocation) => pace.arrive(relocation, "en"));
    const navigation = createReaderNavigation({
      engine,
      commit,
      paint: async () => {
        if (firstPaint) {
          firstPaint = false;
          await barrier;
        }
      },
    });
    navigation.start(start);
    const off = engine.on("relocate", (relocation) =>
      navigation.relocate(relocation),
    );
    const recovery = vi.spyOn(engine, "goTo");
    vi.spyOn(view, "next").mockImplementation(async () =>
      view.report("navigation", 0.4, 1, range, 0),
    );
    vi.spyOn(view, "prev").mockImplementation(async () =>
      view.report("navigation", 0.3, 0, range, 0.75),
    );
    try {
      now = 10_000;
      const forward = navigation.turn("next");
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(commit).not.toHaveBeenCalled();
      expect(navigation.history.current?.locator.sectionIndex).toBe(0);
      finishPaint();
      await expect(forward).resolves.toMatchObject({
        sectionIndex: 1,
        totalProgression: 0.4,
      });
      expect(commit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          reason: "turn",
          origin: "human",
          activity: "turn",
          navigationId: 1,
        }),
      );
      expect(pace.get("en")?.samples).toBe(1);
      now = 20_000;
      await expect(navigation.turn("prev")).resolves.toMatchObject({
        sectionIndex: 0,
        totalProgression: 0.3,
      });
      expect(commit).toHaveBeenCalledTimes(2);
      expect(pace.get("en")?.samples).toBe(1);
      expect(navigation.history.entries).toHaveLength(1);
      expect(navigation.history.cursor).toBe(0);
      expect(recovery).not.toHaveBeenCalled();
    } finally {
      off();
      offRaw();
      navigation.destroy();
    }
  });
  it("tags owned turns and distinguishes layout/speech from human completion", async () => {
    const seen = vi.fn();
    engine.on("relocate", seen);
    await engine.next({ id: 71, signal: new AbortController().signal });
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reason: "turn",
        origin: "human",
        navigationId: 71,
      }),
    );
    view.renderer.atEnd = true;
    view.report("anchor", 0.7);
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reason: "layout",
        origin: "layout",
        atEnd: false,
        activity: undefined,
      }),
    );
    expect(engine.currentLocator()?.totalProgression).toBe(0.5);
    await engine.goTo(
      { fraction: 0.7 },
      { id: 72, signal: new AbortController().signal, origin: "speech" },
    );
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reason: "jump",
        origin: "speech",
        navigationId: 72,
        atEnd: false,
        activity: undefined,
      }),
    );
  });
  const withNotes = async (
    at?: import("@/lib/reader/engine").DurtalLocator,
    book?: FoliateBook,
  ) => {
    engine.destroy();
    fixtures.book = book ?? {
      sections: [
        { id: "a", size: 6000 },
        { id: "b", size: 9000 },
        { id: "notes", size: 2000, linear: "no" },
      ],
      resolveHref: (href) => ({
        index: href.startsWith("notes") ? 2 : href.startsWith("b") ? 1 : 0,
      }),
    };
    engine = createFoliateEngine();
    let info!: import("@/lib/reader/engine").BookInfo;
    const offReady = engine.on("ready", value => { info = value; });
    await engine.open(
      {
        ebookId: "book",
        fileId: "epub",
        format: "epub",
        size: 1000,
        sha256: "a".repeat(64),
        url: "/unused",
        fallbackUrl: "/unused",
      },
      {
        container: host,
        presentation: presentationFrom(
          READER_DEFAULTS,
          resolveThemeColors(),
          "",
        ),
        at,
      },
    );
    offReady();
    view = host.querySelector("foliate-view") as TestView;
    return info;
  };
  it.each(["success", "cancel", "failure"] as const)("settles Notes -> same-CFI linear end through the actual adapter only after owned paint: %s", async (outcome) => {
    await withNotes();
    const raw = vi.fn();
    const offRaw = engine.on("relocate", raw);
    view.report("page", 0.33, 1);
    let blocked = false, release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const commit = vi.fn();
    const navigation = createReaderNavigation({ engine, commit, paint: async () => { if (blocked) await barrier; } });
    navigation.start(raw.mock.calls.at(-1)![0]);
    const off = engine.on("relocate", event => navigation.relocate(event));
    vi.spyOn(view, "resolveNavigation").mockImplementation(target => ({ index: target === "notes" ? 2 : 1 }));
    vi.spyOn(view.renderer, "goTo").mockImplementation(async target => {
      view.renderer.atEnd = target.index === 1 && target.anchor === 1;
      view.report("anchor", target.index === 2 ? 0.33 : 1, target.index);
    });
    try {
      await navigation.navigate({ href: "notes" }, { source: "link" });
      expect(navigation.current).toMatchObject({ linear: false, atEnd: false, locator: { sectionIndex: 2, totalProgression: 0.33 } });
      // Native R14: an unowned anchor/layout arrival has already returned to
      // the final CFI before Percent100 commits; progress still belongs to33%.
      view.renderer.atEnd = true;
      view.report("anchor", 1, 1);
      for (let i = 0; i < 8; i++) await Promise.resolve();
      const before = navigation.current!;
      expect(before).toMatchObject({ reason: "layout", atEnd: false, locator: { sectionIndex: 1, cfi: "cfi1", totalProgression: 0.33 } });
      expect(navigation.history.entries).toHaveLength(2);
      const cursor = navigation.history.cursor;
      commit.mockClear();
      blocked = true;
      if (outcome === "failure") vi.mocked(view.renderer.goTo).mockRejectedValueOnce(new Error("current endpoint failed"));
      const move = navigation.navigate({ fraction: 1 }, { source: "goto" });
      const rejection = outcome === "failure" ? expect(move).rejects.toThrow("current endpoint failed") : null;
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(commit).not.toHaveBeenCalled();
      expect(navigation.current).toBe(before);
      if (outcome === "cancel") navigation.cancel();
      release();
      if (rejection) await rejection;
      else await expect(move).resolves.toBeNull();
      expect(navigation.history.entries).toHaveLength(2);
      expect(navigation.history.cursor).toBe(cursor);
      if (outcome === "success") {
        expect(commit).toHaveBeenCalledOnce();
        expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ navigationId: 2, origin: "human", reason: "jump", activity: undefined, linear: true, atEnd: true,
          locator: expect.objectContaining({ sectionIndex: 1, cfi: before.locator.cfi, totalProgression: 1 }) }));
        expect(navigation.current?.locator.totalProgression).toBe(1);
        expect(navigation.history.current?.locator.totalProgression).toBe(1);
      } else {
        expect(commit).not.toHaveBeenCalled();
        expect(navigation.current).toBe(before);
        expect(navigation.history.current?.locator.totalProgression).toBe(0.33);
      }
    } finally { release(); off(); offRaw(); navigation.destroy(); }
  });
  it("keeps an existing page list ahead of Adobe fallback, and loads the map before opening otherwise", async () => {
    const book: FoliateBook = {
      sections: [{ id: "a", size: 100 }],
      resolveHref: () => ({ index: 0 }),
      pageList: [{ label: "57", href: "a#p57" }],
      resources: {
        opf: new DOMParser().parseFromString(
          '<package><spine page-map="map"/></package>',
          "application/xml",
        ),
        manifest: [],
        getItemByID: () => ({ href: "maps/pages.xml" }),
      },
    };
    await withNotes(undefined, book);
    expect(fixtures.loadText).not.toHaveBeenCalled();
    expect(book.pageList?.[0].label).toBe("57");
    book.pageList = [];
    await withNotes(undefined, book);
    expect(fixtures.loadText).toHaveBeenCalledWith("maps/pages.xml");
    expect(book.pageList).toEqual([
      { label: "xii", href: "maps/a#p12", subitems: [] },
    ]);
  });
  it("names a paged book's sections by each page's own label (SLN-731)", async () => {
    engine.destroy();
    host.replaceChildren();
    fixtures.book = {
      sections: ["i", "ii", "1"].map((id) => ({ id, size: 100, linear: "yes" })),
      metadata: { title: "Labelled" },
      resolveHref: () => ({ index: 0 }),
      pageList: [
        { label: "i", href: "i" },
        { label: "ii", href: "ii" },
        { label: "1", href: "1" },
      ],
    };
    engine = createFoliateEngine();
    let info: BookInfo | null = null;
    engine.on("ready", (value) => { info = value; });
    await engine.open(
      { ebookId: "book", fileId: "cbz", format: "cbz", size: 1000, sha256: "b".repeat(64), url: "/unused", fallbackUrl: "/unused" },
      { container: host, presentation: presentationFrom(READER_DEFAULTS, resolveThemeColors(), "") },
    );
    // As the bar names them: a Roman page is "p. ii", a numbered one "Page 1"
    expect(info!.sections.map((section) => section.label)).toEqual(["p. i", "p. ii", "Page 1"]);
    expect(info!.pagedSections).toBe(true);
  });
  it("retains the linear projection in real note locators and rehydrates it before the note anchor", async () => {
    await withNotes();
    view.report("page", 0.42, 0);
    const seen = vi.fn();
    engine.on("relocate", seen);
    view.report("anchor", 1, 2);
    expect(engine.currentLocator()).toMatchObject({
      href: "notes",
      sectionIndex: 2,
      progression: 1,
      totalProgression: 0.42,
    });
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        linear: false,
        atEnd: false,
        locator: expect.objectContaining({ totalProgression: 0.42 }),
      }),
    );
    const saved = { ...engine.currentLocator()!, cfi: "notes-cfi" };
    await withNotes(saved);
    expect(engine.currentLocator()).toMatchObject({
      sectionIndex: 2,
      totalProgression: 0.42,
    });
  });
  it.each(["reflowable", "pre-paginated"] as const)("keeps0/100 inside the linear order for%s", async layout => {
    await withNotes(undefined, {
      rendition: { layout },
      sections: [
        { id: "front-note", size: 500, linear: "no" },
        { id: "a", size: 6000 },
        { id: "b", size: 9000 },
        { id: "end-note", size: 500, linear: "no" },
      ],
      resolveHref: () => ({ index: 1 }),
    });
    const go = vi.spyOn(view.renderer, "goTo");
    await engine.firstPage();
    expect(go).toHaveBeenLastCalledWith(layout === "reflowable" ? { index: 1, anchor: 0 } : { index: 1 });
    await engine.lastPage();
    expect(go).toHaveBeenLastCalledWith(layout === "reflowable" ? { index: 2, anchor: 1 } : { index: 2 });
  });
  it.each(["flat", "nested", "nested-duplicates", "same-section-duplicates"] as const)("carries%s Page parser identity to the adapter while requiring a visible marker", async shape => {
    const pages = [
      { label: "xii", href: "a#page-xii" },
      { label: "57", href: "a#page-57" },
      { label: "58", href: "a#page-58" },
    ];
    const info = await withNotes(undefined, {
      sections: [{ id: "a", size: 6000 }, { id: "b", size: 9000 }],
      pageList: shape === "flat" ? pages : [
        ...(shape === "nested-duplicates" ? [{ label: "57", href: "b#other57" }] : []),
        ...(shape === "same-section-duplicates" ? [{ label: "57", href: "a#other57" }] : []),
        { label: "Pages", href: "", subitems: pages },
      ],
      resolveHref: () => ({ index: 0 }),
    });
    const positions = new PositionIndex(info, {
      "a#page-xii": .05, "a#page-57": .5, "a#page-58": .6, "b#other57": .9, "a#other57": .9,
    });
    const doc = view.frame.contentDocument!;
    doc.body.innerHTML = '<span id="other57" style="visibility:hidden"></span><span id="page-xii"></span><p>Roman page text.</p><p>Visible text before.</p><span id="page-57"></span><p>Page57 text.</p><span id="page-58"></span><p>Page58 text.</p>';
    const whole = doc.createRange();
    whole.selectNodeContents(doc.body);
    const after57 = doc.createRange();
    after57.setStartBefore(doc.getElementById("page-58")!);
    after57.setEndAfter(doc.body.lastChild!);
    // Modeled native geometry: a real zero-area inline marker lies inside
    // a mounted frame and the renderer's clipped viewport. These fixtures
    // exercise the guard; root's six native receipts supply actual measurements.
    const frame = view.frame;
    Object.defineProperty(doc.defaultView!, "frameElement", { configurable: true, value: frame });
    for (const element of [frame, view.renderer]) {
      for (const key of ["offsetWidth", "clientWidth"]) Object.defineProperty(element, key, { configurable: true, value: 500 });
      for (const key of ["offsetHeight", "clientHeight"]) Object.defineProperty(element, key, { configurable: true, value: 500 });
      element.getBoundingClientRect = () => new DOMRect(0, 0, 500, 500);
    }
    view.renderer.style.overflowX = "hidden"; view.renderer.style.overflowY = "hidden";
    const marker = doc.getElementById("page-57")!;
    doc.getElementById("other57")!.getClientRects = () => [new DOMRect(20, 20, 0, 0)] as unknown as DOMRectList;
    doc.getElementById("page-xii")!.getClientRects = () => [new DOMRect(10, 10, 0, 0)] as unknown as DOMRectList;
    doc.getElementById("page-58")!.getClientRects = () => [new DOMRect(150, 150, 0, 0)] as unknown as DOMRectList;
    let observedPage = "xii";
    let physical = true;
    marker.getClientRects = () => (physical ? [new DOMRect(100, 100, 0, 0)] : []) as unknown as DOMRectList;
    let visible = whole;
    const publish = (reason: string) => {
      const detail: FoliateProgress = { reason, index: 0, fraction: 0.5, sectionFraction: 0.5,
        cfi: observedPage === "xii" ? "roman-cfi" : "saved-cfi", range: visible, pageItem: { label: observedPage } };
      view.lastLocation = detail;
      view.dispatchEvent(new CustomEvent("relocate", { detail }));
    };
    const resolve = vi.spyOn(view, "resolveNavigation").mockImplementation(target => ({
      index: target === "b#other57" ? 1 : 0,
      anchor: target === "a#other57" ? frame => frame.getElementById("other57")!
        : target === "a#page-57" ? frame => frame.getElementById("page-57")!
        : target === "a#page-xii" ? frame => frame.getElementById("page-xii")!
        : target === "a#page-58" ? frame => frame.getElementById("page-58")! : () => whole,
    }));
    vi.spyOn(view.renderer, "goTo").mockImplementation(async () => publish("navigation"));
    // GoToDialog passes parseGoTo's target through the navigation controller.
    // Exercise that actual parser result rather than manually constructing page.
    const roman = parseGoTo("page", "p. XII", positions);
    expect(roman).toEqual({ target: { page: "xii", href: "a#page-xii" } });
    await engine.goTo(roman.target!);
    expect(engine.currentLocator()?.pageLabel).toBe("xii");
    observedPage = "58"; // Natural end-of-visible-range page on the wide spread.
    const numeric = parseGoTo("page", "page 57", positions);
    expect(numeric).toEqual({ target: { page: "57", href: "a#page-57" } });
    await engine.goTo(numeric.target!);
    expect(engine.currentLocator()?.pageLabel).toBe("57");
    expect(engine.currentLocator()?.cfi).toBe("saved-cfi");
    const saved = structuredClone(engine.currentLocator()!);
    expect(resolve).not.toHaveBeenCalledWith("b#other57");
    expect(resolve).not.toHaveBeenCalledWith("a#other57");
    const sparse = parseGoTo("page", "page 59", positions);
    expect(sparse).toEqual({ target: { page: "58", href: "a#page-58" } });
    await engine.goTo(sparse.target!);
    expect(engine.currentLocator()?.pageLabel).toBe("58");
    expect(resolve).toHaveBeenCalledWith("a#page-58");
    await engine.goTo(saved);
    expect(engine.currentLocator()?.pageLabel).toBe("57");
    publish("anchor"); // Same visible spread after layout/paint.
    expect(engine.currentLocator()?.pageLabel).toBe("57");
    publish("page"); // A real turn resumes ordinary visible-page reporting.
    expect(engine.currentLocator()?.pageLabel).toBe("58");
    await engine.goTo(saved);
    expect(engine.currentLocator()?.pageLabel).toBe("57");
    expect(engine.currentLocator()?.cfi).toBe(saved.cfi);
    expect(engine.currentLocator()?.text).toEqual(saved.text);
    // The observed CFI section wins over stale optional saved section/href.
    const dispatch = vi.mocked(view.renderer.goTo);
    dispatch.mockClear();
    await engine.goTo({ ...saved, sectionIndex: 1, href: "b" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0].index).toBe(0);
    expect(engine.currentLocator()).toMatchObject({ sectionIndex: 0, cfi: saved.cfi, pageLabel: "57" });
    if (shape === "same-section-duplicates") {
      // A rejecting earlier duplicate is optional; the later visible one and
      // saved CFI remain usable. No page-href resolution causes a second jump.
      const normalResolve = resolve.getMockImplementation()!;
      resolve.mockImplementation(target => target === "a#other57"
        ? Promise.reject(new Error("optional duplicate unavailable")) as unknown as ReturnType<typeof normalResolve>
        : normalResolve(target));
      dispatch.mockClear();
      await engine.goTo(saved);
      expect(dispatch).toHaveBeenCalledOnce();
      expect(dispatch.mock.calls[0][0].index).toBe(0);
      expect(engine.currentLocator()).toMatchObject({ cfi: saved.cfi, pageLabel: "57" });
      resolve.mockImplementation(normalResolve);
      // When all matching markers in the restored section are ineligible,
      // keep the exact CFI and fall back to the naturally observed page58.
      physical = false;
      await engine.goTo(saved);
      expect(engine.currentLocator()).toMatchObject({ cfi: saved.cfi, pageLabel: "58" });
      physical = true;
      await engine.goTo(saved);
      expect(engine.currentLocator()?.pageLabel).toBe("57");
    }
    await expect(engine.goTo({ page: "57", href: "a#not-a-canonical-page" })).rejects.toThrow("This edition has no page 57");
    expect(resolve).not.toHaveBeenCalledWith("a#not-a-canonical-page");
    await engine.goTo(saved);
    physical = false;
    publish("anchor");
    expect(engine.currentLocator()?.pageLabel).toBe("58"); // Rectless inside-range marker cannot supply57.
    physical = true;
    marker.getClientRects = () => [new DOMRect(1000, 100, 0, 0)] as unknown as DOMRectList;
    publish("anchor");
    expect(engine.currentLocator()?.pageLabel).toBe("58"); // Offscreen inside-range marker cannot supply57.
    marker.getClientRects = () => [new DOMRect(100, 100, 0, 0)] as unknown as DOMRectList;
    marker.setAttribute("style", "visibility:hidden");
    publish("anchor");
    expect(engine.currentLocator()?.pageLabel).toBe("58");
    marker.removeAttribute("style");
    visible = after57;
    publish("anchor");
    expect(engine.currentLocator()?.pageLabel).toBe("58"); // A stale requested label cannot mask invisible57.
    await engine.goTo({ href: "a#page-58" });
    visible = whole;
    publish("anchor");
    expect(engine.currentLocator()?.pageLabel).toBe("58"); // Unrelated navigation cleared the prior target.
  });
  it("restores a valid saved CFI when optional page-href metadata rejects asynchronously", async () => {
    await withNotes(undefined, { sections: [{ id: "a", size: 6000 }], pageList: [{ label: "57", href: "a#page-57" }], resolveHref: () => ({ index: 0 }) });
    const restored = vi.fn(async () => view.report("navigation", 0.5));
    vi.spyOn(view.renderer, "goTo").mockImplementation(restored);
    Object.defineProperty(view, "resolveNavigation", { configurable: true, value: (target: unknown) => {
      if (target === "a#page-57") return Promise.reject(new Error("optional page href unavailable"));
      return { index: 0 };
    } });
    await engine.goTo({ v: 1, fileHash: "a".repeat(64), href: "a", sectionIndex: 0,
      progression: 0.5, totalProgression: 0.5, cfi: "valid-saved-cfi", pageLabel: "57" });
    expect(restored).toHaveBeenCalledWith({ index: 0 });
    expect(engine.currentLocator()?.totalProgression).toBe(0.5);
    expect(engine.currentLocator()?.pageLabel).toBeUndefined();
  });
  it("targets the actual final page of the last linear section for 100% and propagates renderer failure", async () => {
    await withNotes();
    const go = vi.spyOn(view.renderer, "goTo");
    const seen = vi.fn();
    engine.on("relocate", seen);
    await engine.lastPage({ id: 7, signal: new AbortController().signal });
    expect(go).toHaveBeenCalledWith({ index: 1, anchor: 1 });
    expect(engine.currentLocator()?.totalProgression).toBe(1);
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({ atEnd: true, navigationId: 7 }),
    );
    go.mockRejectedValueOnce(new Error("renderer failed"));
    await expect(engine.goTo({ href: "b" })).rejects.toThrow("renderer failed");
  });
  it("keeps human page/snap/scroll turns and distinguishes unowned layout from owned jumps", async () => {
    const seen = vi.fn();
    engine.on("relocate", seen);
    await engine.next();
    await engine.prev();
    view.report("snap");
    view.report("scroll");
    view.report("anchor");
    view.report("anchor");
    expect(seen.mock.calls.map(([event]) => event.reason)).toEqual([
      "turn",
      "turn",
      "turn",
      "turn",
      "layout",
      "layout",
    ]);
    await engine.goTo({ fraction: 0.7 });
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "jump" }),
    );
  });
  it("uses renderer terminal visibility rather than a percentage threshold", () => {
    const seen = vi.fn();
    engine.on("relocate", seen);
    view.report("page", 0.99);
    expect(seen.mock.calls[0][0].atEnd).toBe(false);
    view.renderer.atEnd = true;
    view.report("page", 0.7);
    expect(seen.mock.calls[1][0].atEnd).toBe(true);
  });
  it("debounces keyboard selection, gives host coordinates/context and clears it", async () => {
    vi.useFakeTimers();
    const seen = vi.fn();
    engine.on("selection", seen);
    const doc = view.frame.contentDocument!,
      text = doc.querySelector("p")!.firstChild!;
    Object.defineProperty(doc.defaultView!, "frameElement", {
      value: view.frame,
      configurable: true,
    });
    const range = doc.createRange();
    range.setStart(text, 22);
    range.setEnd(text, 131);
    vi.spyOn(Object.getPrototypeOf(range), "getBoundingClientRect")
      .mockReturnValue(new DOMRect(10, 20, 30, 40));
    view.frame.getBoundingClientRect = () => new DOMRect(100, 200, 300, 400);
    doc.getSelection()!.addRange(range);
    doc.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }),
    );
    doc.dispatchEvent(new Event("selectionchange"));
    await vi.advanceTimersByTimeAsync(100);
    doc.dispatchEvent(new Event("selectionchange"));
    await vi.advanceTimersByTimeAsync(149);
    expect(seen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        keyboard: true,
        rect: { left: 110, right: 140, top: 220, bottom: 260 },
      }),
    );
    expect(seen.mock.calls[0][0].locator.text.highlight).toBe(
      range.toString().trim(),
    );
    expect(seen.mock.calls[0][0].locator).toMatchObject({
      pageLabel: "xii",
      tocLabel: "Selected chapter",
    });
    expect(seen.mock.calls[0][0].locator.text.after).toBe(
      (text.textContent ?? "").slice(131),
    );
    engine.clearSelection();
    expect(doc.getSelection()!.isCollapsed).toBe(true);
    expect(seen).toHaveBeenLastCalledWith(null);
  });
});

describe("actual reflowable speech extraction", () => {
  function ranges() {
    const byCfi = new Map<string, Range>();
    vi.spyOn(view, "getCFI").mockImplementation((index, range) => {
      if (!range) return "start";
      const walker = range.startContainer.ownerDocument!.createTreeWalker(
        range.startContainer.ownerDocument!.body,
        4,
      );
      let n = 0;
      for (
        let node = walker.nextNode();
        node && node !== range.startContainer;
        node = walker.nextNode()
      )
        n++;
      const cfi = `speech:${index}:${n}:${range.startOffset}:${range.endOffset}`;
      byCfi.set(cfi, range.cloneRange());
      return cfi;
    });
    vi.spyOn(view, "resolveNavigation").mockImplementation((target) => ({
      index: 0,
      anchor: () => byCfi.get(String(target))!,
    }));
    return byCfi;
  }
  it("starts in the containing visible sentence, maps real ranges, and skips notes/ruby readings/alt text", async () => {
    const map = ranges();
    const doc = view.frame.contentDocument!;
    doc.body.innerHTML =
      '<p lang="en">First sentence. Second <ruby>word<rt>reading</rt></ruby><a role="doc-noteref">1</a> sentence. Third sentence.<img alt="Never spoken"></p><aside epub:type="footnote">Never spoken note.</aside><p lang="fr">Bonjour le monde.</p>';
    const node = doc.querySelector("p")!.firstChild!;
    const visible = doc.createRange();
    visible.setStart(node, 18);
    visible.setEnd(doc.querySelector("ruby")!.firstChild!, 2);
    view.report("page", 0.4, 0, visible);
    const first = await engine.prepareSpeech!({
      target: { kind: "from", from: "visible" },
      signal: new AbortController().signal,
    });
    expect(first.current?.text).toBe("Second word sentence.");
    expect(first.previous?.text).toBe("First sentence.");
    expect(first.next?.text).toBe("Third sentence.");
    expect(first.current?.locator.cfi).toMatch(/^speech:0:/);
    const boundary = doc.createRange();
    boundary.setStart(node, 15);
    boundary.collapse(true);
    map.set("boundary", boundary);
    const atBoundary = await engine.prepareSpeech!({
      target: {
        kind: "from",
        from: { ...first.current!.locator, cfi: "boundary" },
      },
      signal: new AbortController().signal,
    });
    expect(atBoundary.current?.text).toBe("Second word sentence.");
    const next = await engine.prepareSpeech!({
      target: {
        kind: "adjacent",
        direction: "next",
        locator: first.current!.locator,
      },
      signal: new AbortController().signal,
    });
    expect(next.current?.text).toBe("Third sentence.");
    expect(next.next).toMatchObject({ text: "Bonjour le monde.", lang: "fr" });
    const previous = await engine.prepareSpeech!({
      target: {
        kind: "adjacent",
        direction: "previous",
        locator: next.current!.locator,
      },
      signal: new AbortController().signal,
    });
    expect(previous.current?.text).toBe("Second word sentence.");
  });
  it("uses explicit locators for containing starts and skips non-linear sections without moving the renderer", async () => {
    const byCfi = ranges();
    const doc = view.frame.contentDocument!;
    doc.body.innerHTML = "<p>First. Last.</p>";
    const range = doc.createRange();
    range.setStart(doc.querySelector("p")!.firstChild!, 8);
    range.collapse(true);
    byCfi.set("middle", range);
    const notes = vi.fn(async () =>
      new DOMParser().parseFromString("<p>Not linear.</p>", "text/html"),
    );
    const following = vi.fn(async () =>
      new DOMParser().parseFromString(
        '<p lang="it">Prima frase. Seconda frase.</p>',
        "text/html",
      ),
    );
    // Reopen the actual adapter with this concrete section provider.
    fixtures.book = {
      sections: [
        { id: "chapter", size: 100, linear: "yes" },
        { id: "notes", size: 10, linear: "no", createDocument: notes },
        { id: "second", size: 100, linear: "yes", createDocument: following },
      ],
      resolveHref: () => ({ index: 0 }),
    };
    engine.destroy();
    engine = createFoliateEngine();
    await engine.open(
      {
        ebookId: "book",
        fileId: "epub",
        format: "epub",
        size: 1000,
        sha256: "a".repeat(64),
        url: "/unused",
        fallbackUrl: "/unused",
      },
      {
        container: host,
        presentation: presentationFrom(
          READER_DEFAULTS,
          resolveThemeColors(),
          "",
        ),
      },
    );
    view = host.querySelector("foliate-view") as TestView;
    const map = ranges();
    view.frame.contentDocument!.body.innerHTML = "<p>First. Last.</p>";
    const anchor = view.frame.contentDocument!.createRange();
    anchor.setStart(
      view.frame.contentDocument!.querySelector("p")!.firstChild!,
      8,
    );
    anchor.collapse(true);
    map.set("middle", anchor);
    const moved = vi.spyOn(view, "goTo");
    const result = await engine.prepareSpeech!({
      target: {
        kind: "from",
        from: { ...engine.currentLocator()!, cfi: "middle" },
      },
      signal: new AbortController().signal,
    });
    expect(result.current?.text).toBe("Last.");
    expect(result.next?.text).toBe("Prima frase.");
    expect(result.next?.locator.sectionIndex).toBe(2);
    expect(notes).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();
    await expect(
      engine.prepareSpeech!({
        target: {
          kind: "from",
          from: { ...result.current!.locator, fileHash: "b".repeat(64) },
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("another file");
  });
  it("rejects aborted speech extraction without destroying the opened book", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      engine.prepareSpeech!({
        target: { kind: "from", from: "visible" },
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(host.querySelector("foliate-view")).toBe(view);
    expect(engine.currentLocator()).not.toBeNull();
  });
});

it("names the book frame, keeps it available to assistive technology and preserves declared languages", () => {
  const doc = view.frame.contentDocument!;
  // happy-dom does not attach its child Window's native frameElement property.
  Object.defineProperty(doc.defaultView!, "frameElement", {
    value: view.frame,
    configurable: true,
  });
  view.report("page", 0.4, 0);
  expect(view.frame.getAttribute("aria-label")).toContain("Test");
  expect(view.frame.hasAttribute("aria-hidden")).toBe(false);
  expect(view.frame.hasAttribute("inert")).toBe(false);
  expect(view.frame.tabIndex).toBe(0);
  expect(doc.documentElement.lang).toBe("und");
  doc.documentElement.lang = "fr";
  view.dispatchEvent(
    new CustomEvent("relocate", {
      detail: {
        ...view.lastLocation!,
        reason: "page",
        tocItem: { label: "Chapter seven", href: "chapter" },
      },
    }),
  );
  expect(view.frame.getAttribute("aria-label")).toBe("Test, Chapter seven");
  expect(doc.documentElement.lang).toBe("fr");
  engine.focusBook!();
  expect(doc.activeElement).toBe(doc.body);
});
it.each(["", "fr"])("keeps relocation and live frame metadata when another document has no root (%s)", language => {
  const doc = view.frame.contentDocument!;
  Object.defineProperty(doc.defaultView!, "frameElement", {
    value: view.frame,
    configurable: true,
  });
  doc.documentElement.lang = language;
  view.frame.removeAttribute("aria-label");
  view.frame.setAttribute("aria-hidden", "true");
  view.frame.setAttribute("inert", "");
  const rootless = document.implementation.createHTMLDocument();
  rootless.documentElement.remove();
  expect(rootless.documentElement).toBeNull();
  vi.spyOn(view.renderer, "getContents").mockReturnValue([
    { doc: rootless, index: 1 },
    { doc, index: 0 },
  ]);
  const relocated = vi.fn();
  engine.on("relocate", relocated);
  view.dispatchEvent(new CustomEvent("relocate", {
    detail: {
      ...view.lastLocation!,
      reason: "page",
      fraction: 0.4,
      tocItem: { label: "Chapter seven", href: "chapter" },
    },
  }));
  expect(relocated).toHaveBeenCalledOnce();
  expect(engine.currentLocator()?.tocLabel).toBe("Chapter seven");
  expect(view.frame.getAttribute("aria-label")).toBe("Test, Chapter seven");
  expect(view.frame.hasAttribute("aria-hidden")).toBe(false);
  expect(view.frame.hasAttribute("inert")).toBe(false);
  expect(view.frame.tabIndex).toBe(0);
  expect(doc.documentElement.lang).toBe(language || "und");
});
it("requests owned movement when keyboard focus enters text outside the visible range", () => {
  const doc = view.frame.contentDocument!;
  doc.body.innerHTML =
    '<p><a href="#first">First link.</a> <a href="#second">Second link.</a></p>';
  const visible = doc.createRange();
  visible.selectNodeContents(doc.querySelector("a")!);
  view.report("page", 0.4, 0, visible);
  const focus = vi.fn();
  engine.on("focus", focus);
  doc
    .querySelector("a")!
    .dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(focus).not.toHaveBeenCalled();
  doc
    .querySelectorAll("a")[1]
    .dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(focus).toHaveBeenCalledOnce();
  expect(focus.mock.calls[0][0].locator).toMatchObject({
    fileHash: "a".repeat(64),
    sectionIndex: 0,
    cfi: "epubcfi(selection)",
  });
});
it("creates a real keyboard selection from an exact sentence anchor and rejects another file", () => {
  const doc = view.frame.contentDocument!;
  doc.body.innerHTML = "<p>First sentence. Second sentence.</p>";
  const range = doc.createRange();
  range.setStart(doc.querySelector("p")!.firstChild!, 16);
  range.setEnd(doc.querySelector("p")!.firstChild!, 32);
  vi.spyOn(view, "resolveNavigation").mockReturnValue({
    index: 0,
    anchor: () => range,
  });
  vi.spyOn(range, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    right: 120,
    bottom: 35,
    width: 110,
    height: 15,
  } as DOMRect);
  const selected = vi.fn();
  engine.on("selection", selected);
  expect(
    engine.selectSpeechSentence!({
      ...engine.currentLocator()!,
      cfi: "sentence",
    }),
  ).toBe(true);
  expect(doc.getSelection()?.toString()).toBe("Second sentence.");
  expect(selected).toHaveBeenCalledWith(
    expect.objectContaining({ text: "Second sentence.", keyboard: true }),
  );
  expect(
    engine.selectSpeechSentence!({
      ...engine.currentLocator()!,
      fileHash: "b".repeat(64),
      cfi: "sentence",
    }),
  ).toBe(false);
});
