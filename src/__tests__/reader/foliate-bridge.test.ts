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
vi.mock("@/vendor/foliate-js/vendor/zip.js", () => ({}));
vi.mock("@/lib/reader/engines/foliate/zip-reader", () => ({
  makeRangeZipLoader: async () => ({ entries: [] }),
}));
vi.mock("@/vendor/foliate-js/epub.js", () => ({
  EPUB: class {
    async init() {
      return {
        sections: [{ id: "chapter", size: 100, linear: "yes" }],
        metadata: { title: "Test" },
        resolveHref: () => ({ index: 0 }),
      };
    }
  },
}));
vi.mock("@/vendor/foliate-js/view.js", () => ({}));
import { createFoliateEngine } from "@/lib/reader/engines/foliate/engine";
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
  });
  lastLocation = null;
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
  report(reason: string, fraction = 0.4) {
    this.dispatchEvent(
      new CustomEvent("relocate", {
        detail: {
          reason,
          fraction,
          index: 0,
          sectionFraction: fraction,
          cfi: `cfi${fraction}`,
          range: null,
        },
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
  resolveNavigation() {
    return { index: 0 };
  }
  close() {}
}
let host: HTMLElement, engine: ReaderEngine, view: TestView;
beforeAll(() => {
  if (!customElements.get("foliate-view"))
    customElements.define("foliate-view", TestView);
});
beforeEach(async () => {
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
  it("keeps page/snap/scroll turns and classifies direct link/history anchor relocates as jumps", async () => {
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
      "jump",
      "jump",
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
    expect(seen.mock.calls[0][0].locator.text.after).toBe(
      (text.textContent ?? "").slice(131),
    );
    engine.clearSelection();
    expect(doc.getSelection()!.isCollapsed).toBe(true);
    expect(seen).toHaveBeenLastCalledWith(null);
  });
});
