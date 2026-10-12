// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoliateBook, FoliateProgress } from "@/lib/reader/engines/foliate/foliate";
import type { ReaderEngine } from "@/lib/reader/engine";
vi.mock("@/vendor/foliate-js/vendor/zip.js", () => ({}));
vi.mock("@/lib/reader/engines/foliate/zip-reader", () => ({ makeRangeZipLoader: async () => ({ entries: [], loadText: async () => null }) }));
vi.mock("@/vendor/foliate-js/epub.js", () => ({ EPUB: class {
  async init(): Promise<FoliateBook> { return { sections: [{ id: "chapter", size: 6000 }], resolveHref: () => ({ index: 0 }) }; }
} }));
vi.mock("@/vendor/foliate-js/view.js", () => ({}));
import { createFoliateEngine } from "@/lib/reader/engines/foliate/engine";
import { presentationFromPreferences } from "@/lib/reader/presentation";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function response(path: string) {
  const bytes = Uint8Array.from(readFileSync(new URL("../../../public" + path, import.meta.url)));
  return new Response(bytes.buffer, { status: 200 });
}
let openGate: ReturnType<typeof deferred> | null, viewStarted: ReturnType<typeof deferred>;
class FontView extends HTMLElement {
  renderer = Object.assign(document.createElement("div"), { getContents: () => [], setStyles: vi.fn() });
  lastLocation: FoliateProgress | null = null;
  async open() { this.append(this.renderer); viewStarted.resolve(); await openGate?.promise; }
  async init() {
    this.lastLocation = { reason: "page", index: 0, fraction: 0, sectionFraction: 0, cfi: "epubcfi(test)", range: null };
    this.dispatchEvent(new CustomEvent("relocate", { detail: this.lastLocation }));
  }
  getCFI() { return "epubcfi(test)"; }
  getSectionFractions() { return [0, 1]; }
  getProgressOf() { return {}; }
  close() {}
}
const NativeURL = URL;
let engine: ReaderEngine, host: HTMLElement;
beforeAll(() => { if (!customElements.get("foliate-view")) customElements.define("foliate-view", FontView); });
beforeEach(() => {
  let sequence = 0;
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No font network prerequisite"); }));
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL() { return "blob:reader-cache-" + ++sequence; }
    static revokeObjectURL() {}
  });
  openGate = null; viewStarted = deferred();
  host = document.createElement("div"); document.body.append(host);
});
afterEach(() => { engine?.destroy(); host.remove(); vi.unstubAllGlobals(); });
const source = { ebookId: "book", fileId: "epub", format: "epub" as const, size: 1000, sha256: "a".repeat(64), url: "/unused", fallbackUrl: "/unused" };
const presentation = (font: "literata" | "inter") => presentationFromPreferences({ ...PRESENTATION_DEFAULTS.desktop, font }, location.origin);

describe("Foliate parent-cache presentation ownership", () => {
  it("waits for newer B cache bytes when B is selected during pending view.open, without replaying applied A", async () => {
    const newerFonts = deferred(); openGate = deferred();
    const match = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.includes("/inter/")) await newerFonts.promise;
      return response(path);
    });
    vi.stubGlobal("caches", { match }); engine = createFoliateEngine();
    let finished = false;
    const opened = engine.open(source, { container: host, presentation: presentation("literata") }).then(result => { finished = true; return result; });
    await viewStarted.promise;
    const view = host.querySelector("foliate-view") as FontView;
    engine.setPresentation(presentation("literata"));
    expect(view.renderer.setStyles).toHaveBeenLastCalledWith(expect.stringContaining("Durtal Literata"));
    engine.setPresentation(presentation("inter"));
    await vi.waitFor(() => expect(match.mock.calls.filter(([url]) => url.includes("/inter/"))).toHaveLength(12));
    openGate.resolve();
    for (let n = 0; n < 12; n++) await Promise.resolve();
    expect(finished).toBe(false);
    expect(view.renderer.setStyles).toHaveBeenCalledTimes(1);
    newerFonts.resolve(); await opened;
    expect(view.renderer.setStyles).toHaveBeenLastCalledWith(expect.stringContaining("Durtal Inter"));
    const last = view.renderer.setStyles.mock.calls.at(-1)![0] as string;
    expect(last).toContain('url("blob:reader-cache-'); expect(last).not.toContain(location.origin + "/fonts/reader/");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retries cached fonts on same-section settings after a cold-cache open and later offline download", async () => {
    let warm = false;
    const match = vi.fn(async (url: string) => warm ? response(new URL(url).pathname) : undefined);
    vi.stubGlobal("caches", { match }); engine = createFoliateEngine();
    await engine.open(source, { container: host, presentation: presentation("literata") });
    const view = host.querySelector("foliate-view") as FontView, readsBefore = match.mock.calls.length;
    expect(view.renderer.setStyles).toHaveBeenLastCalledWith(expect.stringContaining(location.origin + "/fonts/reader/"));
    warm = true; engine.setPresentation(presentation("literata"));
    await vi.waitFor(() => expect(view.renderer.setStyles).toHaveBeenLastCalledWith(expect.stringContaining('url("blob:reader-cache-')));
    expect(match.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(fetch).not.toHaveBeenCalled();
  });
});
