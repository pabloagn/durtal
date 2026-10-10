// @vitest-environment happy-dom
// React/geometry model only; actual visibility and trusted input remain native gates.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, StrictMode, Suspense, useRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ factory: vi.fn(), preload: vi.fn() }));
vi.mock("@/lib/reader/engines/foliate/preload", () => ({ preloadFoliate: mocks.preload }));
vi.mock("@/components/reader/settings-dialog", () => ({ SettingsDialog: () => null }));
// Model the Next server-action reply at its transport boundary. The real
// preference hook/saver validates it and controls admission; writes are unexpected.
vi.mock("@/lib/actions/reader-preferences", async () => {
  const { preferenceAdoptionSchema } = await import("@/lib/reader/presentation/preference-plan");
  return {
    adoptLegacyReaderSettings: async (input: unknown) => ({
      ok: true as const, ...preferenceAdoptionSchema.parse(input), rows: [],
    }),
    updateReaderPreferences: async () => { throw new Error("Unexpected reading-settings write in reader fixture"); },
    resetReaderPreferences: async () => { throw new Error("Unexpected reading-settings reset in reader fixture"); },
  };
});
import * as foliateEngineModule from "@/lib/reader/engines/foliate/engine";
// EB Garamond loads through next/font, which needs the Next compiler.
vi.mock("next/font/google", () => ({ EB_Garamond: () => ({ variable: "font-prose" }) }));
import { ReaderView } from "@/app/reader/[ebookId]/reader-view";
import { useReaderController, useReaderControllerFailure, readerControllerFailureVisible } from "@/components/reader/bridge";
import type { ReaderControllerFailureProps } from "@/lib/reader/bridge-state";
import { fakeEngine } from "./fixtures/fake-engine";
let root: Root, host: HTMLElement, fake: ReturnType<typeof fakeEngine>;
// Canonical identities also reach preference and durable annotation consumers.
const bookId = "11111111-1111-4111-8111-111111111111";
const epubId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const oldFileId = "77777777-7777-4777-8777-777777777777";
const newFileId = "88888888-8888-4888-8888-888888888888";
const id = "test-functional-controller";
const activity = vi.fn(), location = vi.fn(), end = vi.fn(), selection = vi.fn();
const handlers = { activity, location, end, selection };
function Failure({ id, code }: ReaderControllerFailureProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  useReaderControllerFailure(id, code, ref);
  return h("p", { ref, "data-test-failure": "true" }, "Feature unavailable");
}
function Functional({ ready = true, children }: { ready?: boolean; children?: import("react").ReactNode }) {
  return ready ? h(Installed, null, children) : null;
}
function Installed({ children }: { children?: import("react").ReactNode }) {
  useReaderController(id, handlers);
  return h(Suspense, { fallback: null }, children);
}
function props(ready = true, fileId = epubId): ComponentProps<typeof ReaderView> {
  return {
    ebook: { id: bookId, title: "Book", authors: [] },
    file: { id: fileId, format: "epub" as const, size: 1000, sha256: "a".repeat(64), url: "/file", expiresAt: null, fallbackUrl: "/file", cdOffset: null },
    alternatives: [], place: null, devicePlace: null, otherPlace: null,
    deviceId, backHref: "/library", requiredControllerIds: [id],
    plugins: [{ id, controller: true as const, node: h(Functional, { ready }), failureNode: h(Failure, { id, code: "reader_controller_failed" as const }) }],
  };
}
const flush = () => act(async () => {
  for (let n = 0; n < 3; n++) await new Promise((resolve) => requestAnimationFrame(resolve));
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fake = fakeEngine();
  mocks.factory = vi.spyOn(foliateEngineModule, "createFoliateEngine")
    .mockReturnValue(fake.engine);
  mocks.preload.mockReset().mockResolvedValue(undefined);
  Object.values(handlers).forEach((handler) => handler.mockReset());
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = url.includes("/annotations")
      ? { annotations: [], serverTime: "2026-10-09T11:00:00Z", reset: false }
      : { positions: [] };
    return new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }));
  vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("ReaderSession controller admission", () => {
  it("handles synchronous first engine events and first input while secondary UI is suspended", async () => {
    const waiting = new Promise<void>(() => {});
    function SlowUi(): never { throw waiting; }
    const original = fake.engine.open.getMockImplementation()!;
    fake.engine.open.mockImplementation(async (source, options) => {
      const opened = original(source, options);
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      fake.emit("selection", { text: "First selection", locator: fake.engine.currentLocator()!, rect: { left: 0, top: 0, right: 100, bottom: 30 }, keyboard: false });
      fake.emit("relocate", { locator: fake.engine.currentLocator()!, reason: "jump", origin: "human", chapter: null, atEnd: true, tocItem: null, visibleChars: 300, linear: true, paginated: true });
      return opened;
    });
    const p = props(); p.plugins[0].node = h(Functional, null, h(SlowUi));
    await act(async () => root.render(h(ReaderView, p))); await flush();
    expect(fake.engine.open).toHaveBeenCalledOnce();
    Object.values(handlers).forEach((handler) => expect(handler).toHaveBeenCalledOnce());
  });
  it("preloads bytes but withholds engine and input until the eager controller installs", async () => {
    await act(async () => root.render(h(ReaderView, props(false))));
    expect(mocks.preload).toHaveBeenCalled(); expect(fake.engine.open).not.toHaveBeenCalled();
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); expect(activity).not.toHaveBeenCalled();
    await act(async () => root.render(h(ReaderView, props(true)))); await flush();
    expect(fake.engine.open).toHaveBeenCalledOnce(); expect(location).toHaveBeenCalledOnce();
  });
  it("keeps exactly one functional subscriber and open through StrictMode reacquisition", async () => {
    // Cache this fixture before concurrent StrictMode imports enter Vitest's mock resolver.
    const { createFoliateEngine } = await import("@/lib/reader/engines/foliate/engine");
    expect(createFoliateEngine).toBe(mocks.factory);
    await act(async () => root.render(h(StrictMode, null, h(ReaderView, props()))));
    // Await startup imports before flushing the event bus's display frames.
    await act(async () => { await vi.dynamicImportSettled(); });
    await flush();
    expect(fake.engine.open).toHaveBeenCalledOnce(); expect(location).toHaveBeenCalledOnce();
    act(() => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    await flush(); expect(activity).toHaveBeenCalledOnce();
  });
  it("cancels a pending file generation before synchronous engine startup", async () => {
    await act(async () => root.render(h(ReaderView, props(false, oldFileId))));
    await act(async () => root.render(h(ReaderView, props(true, newFileId)))); await flush();
    expect(fake.engine.open).toHaveBeenCalledOnce();
    expect(fake.engine.open.mock.calls[0][0].fileId).toBe(newFileId); expect(location).toHaveBeenCalledOnce();
  });
  it("fences new input during runtime controller withdrawal without reopening or undoing saves", async () => {
    await act(async () => root.render(h(ReaderView, props()))); await flush();
    activity.mockClear();
    await act(async () => root.render(h(ReaderView, props(false))));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await flush(); expect(fake.engine.goRight).not.toHaveBeenCalled(); expect(activity).not.toHaveBeenCalled();
    await act(async () => root.render(h(ReaderView, props(true))));
    act(() => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    await flush(); expect(activity).toHaveBeenCalledOnce(); expect(fake.engine.open).toHaveBeenCalledOnce();
  });
  it("opens degraded only after the feature-owned failure surface passes the actual DOM visibility check", async () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      return (this.matches("[data-test-failure]") ? [new DOMRect(0, 0, 100, 30)] : []) as unknown as DOMRectList;
    });
    const p = props(); p.plugins[0].node = null;
    const plugin = { ...p.plugins[0], failure: "reader_controller_load_failed" as const };
    act(() => root.render(h(ReaderView, { ...p, plugins: [plugin] })));
    expect(fake.engine.open).not.toHaveBeenCalled(); expect(host.querySelector("[data-test-failure]")).not.toBeNull();
    await flush(); expect(fake.engine.open).toHaveBeenCalledOnce(); expect(location).not.toHaveBeenCalled();
  });
  it("replaces a crashed controller boundary so its failure surface can mount and admit degraded opening", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      return (this.matches("[data-test-failure]") ? [new DOMRect(0, 0, 100, 30)] : []) as unknown as DOMRectList;
    });
    function CrashingController(): never {
      useReaderController(id, handlers);
      throw new Error("Eager controller render failed");
    }
    const p = props();
    p.plugins[0].node = h(CrashingController);
    act(() => root.render(h(ReaderView, p)));
    expect(host.querySelector("[data-test-failure]")?.textContent).toBe("Feature unavailable");
    expect(fake.engine.open).not.toHaveBeenCalled();
    await flush();
    expect(fake.engine.open).toHaveBeenCalledOnce();
    Object.values(handlers).forEach((handler) => expect(handler).not.toHaveBeenCalled());
  });
  it("rejects disconnected, hidden, transparent and offscreen failure surfaces", () => {
    const node = document.createElement("p");
    vi.spyOn(node, "getClientRects").mockReturnValue([new DOMRect(0, 0, 100, 30)] as unknown as DOMRectList);
    expect(readerControllerFailureVisible(node)).toBe(false); host.append(node);
    expect(readerControllerFailureVisible(node)).toBe(true);
    host.style.opacity = "0"; expect(readerControllerFailureVisible(node)).toBe(false); host.style.opacity = "1";
    node.hidden = true; expect(readerControllerFailureVisible(node)).toBe(false); node.hidden = false;
    vi.mocked(node.getClientRects).mockReturnValue([new DOMRect(-200, 0, 100, 30)] as unknown as DOMRectList);
    expect(readerControllerFailureVisible(node)).toBe(false);
  });
});
