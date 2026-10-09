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
import { createFoliateEngine } from "@/lib/reader/engines/foliate/engine";
import { createReaderNavigation } from "@/lib/reader/navigation";
import { PaceModel } from "@/lib/reader/pace";
import type { ReaderEngine } from "@/lib/reader/engine";
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
  getCFI() {
    return "epubcfi(selection)";
  }
  getProgressOf() {
    return {
      tocItem: { label: "Selected chapter" },
      pageItem: { label: "xii" },
    };
  }
  resolveNavigation(target?: unknown) {
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
});
describe("foliate bridge adapter", () => {
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
    view = host.querySelector("foliate-view") as TestView;
  };
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
    range.getBoundingClientRect = () => new DOMRect(10, 20, 30, 40);
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
