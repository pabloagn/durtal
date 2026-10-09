// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ factory: vi.fn() }));
vi.mock("@/lib/reader/engines/foliate/engine", () => ({
  createFoliateEngine: mocks.factory,
}));
vi.mock("@/lib/reader/engines/foliate/preload", () => ({
  preloadFoliate: () => Promise.resolve(),
}));
vi.mock("@/components/reader/contents-dialog", () => ({
  ContentsDialog: () => null,
}));
vi.mock("@/components/reader/settings-dialog", () => ({
  SettingsDialog: () => null,
}));
import { ReaderView } from "@/app/reader/[ebookId]/reader-view";
import type { ReaderPlace } from "@/lib/reader/sync/places";
import { place } from "./fixtures/places";
import { fakeEngine } from "./fixtures/fake-engine";
import { ProbePlugin } from "./fixtures/probe-plugin";
let host: HTMLElement, root: Root, fake: ReturnType<typeof fakeEngine>;
const own = place(),
  other = place({
    thisDevice: false,
    deviceId: "phone",
    deviceLabel: "iPhone · Safari",
    clientUpdatedAt: "2026-10-09T11:00:00Z",
    locator: {
      ...own.locator,
      sectionIndex: 5,
      progression: 0.6,
      totalProgression: 0.7,
      pageLabel: "212",
    },
  });
const report = vi.fn();
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    clear: () => storage.clear(),
  });
  fake = fakeEngine();
  mocks.factory.mockReset().mockReturnValue(fake.engine);
  report.mockReset();
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ positions: [other] }), { status: 200 }),
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const render = (
  place: ReaderPlace | null = own,
  devicePlace: ReaderPlace | null = own,
  otherPlace: ReaderPlace | null = other,
) =>
  act(async () => {
    root.render(
      h(ReaderView, {
        ebook: { id: "book", title: "Book", authors: [] },
        file: {
          id: "epub",
          format: "epub",
          size: 1000,
          sha256: "a".repeat(64),
          url: "/file",
          expiresAt: null,
          fallbackUrl: "/file",
          cdOffset: null,
        },
        alternatives: [],
        place,
        devicePlace,
        otherPlace,
        deviceId: "mac",
        backHref: "/library",
        plugins: [{ id: "probe", node: h(ProbePlugin, { data: { report } }) }],
      }),
    );
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
    else await new Promise((resolve) => setTimeout(resolve, 10));
  });
const button = (text: string) =>
  [...host.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  )!;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await Promise.resolve();
  });
describe("reader view with a real bridge and fake engine", () => {
  it("opens at this device's place, offers without a jump, and Go there emits a jump", async () => {
    await render();
    expect(fake.engine.open.mock.calls[0][1].at).toEqual(own.locator);
    expect(fake.engine.goTo).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Page 212 · read on iPhone");
    await settle();
    expect(report).toHaveBeenCalledWith(
      "location",
      expect.objectContaining({ kind: "jump", percent: 40 }),
    );
    act(() => button("Go there").click());
    await settle();
    expect(fake.engine.goTo).toHaveBeenCalledWith(other.locator);
    expect(report).toHaveBeenCalledWith(
      "location",
      expect.objectContaining({ kind: "jump", percent: 70 }),
    );
    expect(host.textContent).not.toContain("Go there");
    expect(mocks.factory).toHaveBeenCalledOnce();
  });
  it("Stay and a page turn both dismiss the offer without remounting the engine", async () => {
    await render();
    act(() => button("Stay").click());
    expect(fake.engine.goTo).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Go there");
    expect(
      Number(localStorage.getItem("durtal-reader-declined:book:mac")),
    ).toBe(Date.parse(other.clientUpdatedAt));
    act(() => root.unmount());
    root = createRoot(host);
    localStorage.clear();
    await render();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(fake.engine.next).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("Go there");
  });
  it("cross-format resume opens the current file at total progression", async () => {
    const pdf = {
      ...other,
      fileId: "pdf",
      locator: {
        ...other.locator,
        fileHash: "b".repeat(64),
        pdf: { page: 212 },
      },
    };
    await render(own, own, pdf);
    expect(host.textContent).toContain("About 70%");
    act(() => button("Go there").click());
    expect(fake.engine.goTo).toHaveBeenCalledWith({ fraction: 0.7 });
    expect(mocks.factory).toHaveBeenCalledOnce();
  });
  it("a never-opened device starts at the other place and fades its quiet notice", async () => {
    vi.useFakeTimers();
    await render(null, null, other);
    expect(fake.engine.open.mock.calls[0][1].at).toEqual(other.locator);
    expect(host.textContent).toContain("Opened where you left off on iPhone");
    expect(host.textContent).not.toContain("Go there");
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999);
    });
    expect(host.textContent).toContain("Opened where you left off");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(host.textContent).not.toContain("Opened where you left off");
  });
  it("history in another own format is not mistaken for a never-opened device", async () => {
    const pdfOwn = {
      ...own,
      fileId: "pdf",
      locator: { ...own.locator, fileHash: "b".repeat(64) },
    };
    await render(null, pdfOwn, other);
    expect(fake.engine.open.mock.calls[0][1].at).toEqual({ fraction: 0.4 });
    expect(host.textContent).not.toContain("Opened where");
    expect(host.textContent).toContain("Go there");
  });
  it("discards a response after a local turn while a refresh GET is pending", async () => {
    await render();
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await act(async () => {
      finish(
        new Response(
          JSON.stringify({
            positions: [{ ...other, clientUpdatedAt: "2099-01-01T00:00:00Z" }],
          }),
        ),
      );
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("Go there");
  });
  it("refreshes once only after the tab was hidden for at least sixty seconds", async () => {
    await render();
    let now = 1000,
      visibility = "visible";
    vi.spyOn(Date, "now").mockImplementation(() => now);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    const state = async (value: string) =>
      act(async () => {
        visibility = value;
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
      });
    await state("hidden");
    now = 60999;
    await state("visible");
    expect(fetch).not.toHaveBeenCalled();
    await state("hidden");
    now = 120999;
    await state("visible");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual({ cache: "no-store" });
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });
  it("Tab from keyboard selection focuses Copy; Escape clears and Space remains native", async () => {
    await render();
    const doc = document.implementation.createHTMLDocument("book");
    act(() => fake.emit("document", { doc }));
    act(() =>
      fake.emit("selection", {
        text: "Quote",
        locator: own.locator,
        rect: { left: 20, top: 200, right: 200, bottom: 220 },
        keyboard: true,
      }),
    );
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      doc.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("Copy"));
    const space = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      button("Copy").dispatchEvent(space);
    });
    expect(space.defaultPrevented).toBe(false);
    expect(fake.engine.next).not.toHaveBeenCalled();
    act(() => {
      button("Copy").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(fake.engine.clearSelection).toHaveBeenCalledOnce();
    expect(host.querySelector<HTMLElement>('[role="toolbar"]')!.hidden).toBe(
      true,
    );
  });
});
