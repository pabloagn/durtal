// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ factory: vi.fn(), adopt: vi.fn() }));
vi.mock("@/lib/reader/engines/foliate/engine", () => ({
  createFoliateEngine: mocks.factory,
}));
vi.mock("@/lib/reader/engines/foliate/preload", () => ({
  preloadFoliate: () => Promise.resolve(),
}));
// Model the Next server-action reply at its transport boundary. The real
// preference hook/saver validates it and controls admission; writes are unexpected.
vi.mock("@/lib/actions/reader-preferences", async () => {
  const { preferenceAdoptionSchema } = await import("@/lib/reader/presentation/preference-plan");
  return {
    adoptLegacyReaderSettings: (input: unknown) => mocks.adopt(preferenceAdoptionSchema.parse(input)),
    updateReaderPreferences: async () => { throw new Error("Unexpected reading-settings write in reader fixture"); },
    resetReaderPreferences: async () => { throw new Error("Unexpected reading-settings reset in reader fixture"); },
  };
});
import { type PreferenceReply, type PreferenceScope } from "@/lib/reader/presentation/preference-plan";
import { deviceClass as classifyDevice } from "@/lib/reader/presentation/device-class";
import { preferenceCacheKey, serializePreferenceCache } from "@/lib/reader/presentation/preference-cache";
import { READER_SETTINGS_KEY } from "@/lib/preferences";
import { ReaderSlotFill } from "@/components/reader/bridge";
// EB Garamond loads through next/font, which needs the Next compiler.
vi.mock("next/font/google", () => ({ EB_Garamond: () => ({ variable: "font-prose" }) }));
import { ReaderView } from "@/app/reader/[ebookId]/reader-view";
import type { ReaderPlace } from "@/lib/reader/sync/places";
import { place } from "./fixtures/places";
import { fakeEngine } from "./fixtures/fake-engine";
import { ProbePlugin } from "./fixtures/probe-plugin";
// The provider returns a fresh real runtime built with primitive/platform
// injection. The mounted durable queue and store/domain logic remain actual.
const persistenceProvider = vi.hoisted(() => ({
  runtime: null as import("@/lib/reader/offline/transport").ReaderTransport | null,
}));
vi.mock("@/lib/reader/offline/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reader/offline/runtime")>();
  return { ...actual, getReaderRuntime: () => {
    if (!persistenceProvider.runtime) return Promise.reject(new Error("Persistence fixture not installed"));
    return Promise.resolve(persistenceProvider.runtime);
  } };
});
import { mutationWireJson, EXPECTED_DEVICE_HEADER } from "@/lib/reader/offline/mutations";
import { mountedPersistence } from "./fixtures/mounted-persistence";
let persistence: Awaited<ReturnType<typeof mountedPersistence>>;
let host: HTMLElement, root: Root, fake: ReturnType<typeof fakeEngine>;
// Canonical identities also reach preference and durable annotation consumers.
const bookId = "11111111-1111-4111-8111-111111111111";
const epubId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const phoneId = "44444444-4444-4444-8444-444444444444";
const pdfId = "55555555-5555-4555-8555-555555555555";
const replacedId = "66666666-6666-4666-8666-666666666666";
const own = place({ fileId: epubId, deviceId }),
  other = place({
    thisDevice: false,
    deviceId: phoneId,
    fileId: epubId,
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
function ToolbarActions() {
  return h(
    ReaderSlotFill,
    { slot: "selection-actions" },
    h("button", { type: "button" }, "Plugin action one"),
    h("button", { type: "button" }, "Plugin action two"),
  );
}
const report = vi.fn();
beforeEach(async () => {
  mocks.adopt.mockReset().mockImplementation(async (scope: PreferenceScope): Promise<PreferenceReply> => ({ ok: true, ...scope, rows: [] }));
  persistence = await mountedPersistence();
  persistenceProvider.runtime = persistence.runtime;
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
      async (input: RequestInfo | URL, options?: RequestInit) => {
        const path = new URL(input instanceof Request ? input.url : String(input), "http://fixture.invalid").pathname;
        if ((options?.method ?? "GET") !== "GET") throw new Error("Unexpected delivery while fixture is offline");
        const body = path === `/api/reader/${bookId}/annotations`
          ? { annotations: [], serverTime: "2026-10-09T11:00:00Z", reset: false }
          : path === `/api/reader/${bookId}/position` ? { positions: [other] }
          : path === "/api/reader/device" ? { deviceId }
          : null;
        if (!body) throw new Error(`Unexpected reader fixture request: ${path}`);
        return new Response(JSON.stringify(body), {
          status: 200, headers: { "content-type": "application/json" },
        });
      },
    ),
  );
});
afterEach(async () => {
  act(() => root.unmount());
  await persistence.dispose(); persistenceProvider.runtime = null;
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const render = async (
  place: ReaderPlace | null = own,
  devicePlace: ReaderPlace | null = own,
  otherPlace: ReaderPlace | null = other,
  localPreferenceAdmission = false,
) => {
  await act(async () => {
    root.render(
      h(ReaderView, {
        ebook: { id: bookId, title: "Book", authors: [] },
        file: {
          id: epubId,
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
        deviceId,
        backHref: "/library",
        localPreferenceAdmission,
        plugins: [
          { id: "probe", node: h(ProbePlugin, { data: { report } }) },
          { id: "actions", node: h(ToolbarActions) },
        ],
      }),
    );
  });
  // Startup reads this device's committed position before opening/resuming.
  // Wait for the actual landing, not elapsed UI-clock time or microtasks.
  await persistence.waitFor(
    () => host.querySelector('[data-reader="ready"]') !== null,
    "the reader's initial resumed landing",
  );
};
const positionReads = () => vi.mocked(fetch).mock.calls.filter(([input, options]) => {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, "http://fixture.invalid").pathname === `/api/reader/${bookId}/position`
    && (options?.method ?? "GET") === "GET";
});
const button = (text: string) =>
  [...host.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  )!;
const settle = () =>
  act(async () => {
    for (let n = 0; n < 3; n++)
      await new Promise((resolve) => requestAnimationFrame(resolve));
    await Promise.resolve();
  });
describe("reader view with a real bridge and fake engine", () => {
  const pressRight = () =>
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  const turnActivities = () =>
    report.mock.calls.filter(
      ([name, event]) => name === "activity" && event.kind === "turn",
    );
  it.each(["boundary", "failed"])(
    "keeps genuine key activity but publishes no turn for a %s request",
    async (kind) => {
      await render();
      await settle();
      report.mockClear();
      fake.engine.goRight.mockImplementationOnce(async () => {
        if (kind === "failed") throw new Error("failed turn");
      });
      pressRight();
      await settle();
      expect(turnActivities()).toHaveLength(0);
      expect(
        report.mock.calls.some(
          ([name]) => name === "location" || name === "end",
        ),
      ).toBe(false);
      expect(report).toHaveBeenCalledWith(
        "activity",
        expect.objectContaining({ kind: "key" }),
      );
      act(() => window.dispatchEvent(new Event("pagehide")));
      expect(navigator.sendBeacon).not.toHaveBeenCalled();
      expect(await persistence.snapshot(`${bookId}:${epubId}:${deviceId}`)).toEqual({ queued: [], position: undefined });
    },
  );
  it("fades the running lines while the bars cover them and brings them back with the page", async () => {
    await render();
    await settle();
    const bars = host.querySelector("[data-reader-bottom-bar]")!;
    expect(bars.hasAttribute("inert")).toBe(false);
    expect(fake.engine.setMarginaliaHidden).toHaveBeenLastCalledWith(true);
    pressRight();
    await settle();
    expect(bars.hasAttribute("inert")).toBe(true);
    expect(fake.engine.setMarginaliaHidden).toHaveBeenLastCalledWith(false);
  });
  it("publishes turn activity once only after the actual turn settles and paints", async () => {
    await render();
    await settle();
    report.mockClear();
    let release!: () => void;
    const movement = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.engine.goRight.mockImplementationOnce(async (owner) => {
      fake.emit("relocate", {
        locator: {
          ...own.locator,
          progression: 0.3,
          cfi: "next-page",
          totalProgression: 0.5,
        },
        chapter: "Next",
        reason: "turn",
        origin: "human",
        activity: "turn",
        navigationId: owner?.id,
        atEnd: false,
        tocItem: null,
        visibleChars: 300,
        linear: true,
        paginated: true,
      });
      await movement;
    });
    pressRight();
    await settle();
    expect(turnActivities()).toHaveLength(0);
    expect(report.mock.calls.some(([name]) => name === "location")).toBe(false);
    expect(await persistence.snapshot(`${bookId}:${epubId}:${deviceId}`)).toEqual({ queued: [], position: undefined });
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await settle();
    expect(turnActivities(), JSON.stringify(report.mock.calls)).toHaveLength(1);
    expect(
      report.mock.calls.filter(
        ([name, event]) => name === "location" && event.kind === "turn",
      ),
    ).toHaveLength(1);
    const committed = await persistence.committedPositions();
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ state: "waiting", claim: null, mutation: {
      kind: "position", ebookId: bookId, fileId: epubId, deviceId,
      body: { locator: fake.engine.currentLocator() },
    } });
    expect(committed[0].mutation.body.locator).toEqual(fake.engine.currentLocator());
  });
  it("does not publish turn activity for movement cancelled by a replacement jump", async () => {
    await render();
    await settle();
    report.mockClear();
    let release!: () => void;
    const movement = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.engine.goRight.mockImplementationOnce(async (owner) => {
      fake.emit("relocate", {
        locator: {
          ...own.locator,
          progression: 0.3,
          cfi: "cancelled-page",
          totalProgression: 0.5,
        },
        chapter: "Next",
        reason: "turn",
        origin: "human",
        activity: "turn",
        navigationId: owner?.id,
        atEnd: false,
        tocItem: null,
        visibleChars: 300,
        linear: true,
        paginated: true,
      });
      await movement;
    });
    pressRight();
    await settle();
    act(() => fake.emit("link", { href: "replacement", external: false }));
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await settle();
    await settle();
    expect(turnActivities()).toHaveLength(0);
    expect(
      report.mock.calls.some(
        ([name, event]) => name === "location" && event.kind === "turn",
      ),
    ).toBe(false);
    expect(report).toHaveBeenCalledWith(
      "location",
      expect.objectContaining({ kind: "jump", percent: 80 }),
    );
  });
  it("refreshes a reflow anchor without activity, tracker location/end, save, pace or resume dismissal", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await render();
    await settle();
    report.mockClear();
    now.mockReturnValue(1_010_000);
    act(() =>
      fake.emit("relocate", {
        locator: {
          ...own.locator,
          cfi: "reflowed-anchor",
          totalProgression: 1,
        },
        chapter: "Reflow",
        reason: "layout",
        origin: "layout",
        atEnd: true,
        tocItem: null,
        visibleChars: 300,
        linear: true,
        paginated: true,
      }),
    );
    await settle();
    expect(host.querySelector("[data-reader-probe]")?.textContent).toBe("40");
    expect(host.textContent).toContain("Go there");
    expect(report).not.toHaveBeenCalled();
    expect(localStorage.getItem("durtal-reader-pace")).toBeNull();
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
    expect(await persistence.snapshot(`${bookId}:${epubId}:${deviceId}`)).toEqual({ queued: [], position: undefined });
  });
  it("uses the same non-linear note projection in UI, bridge and saved locator", async () => {
    await render();
    await settle();
    report.mockClear();
    const note = {
      ...own.locator,
      href: "notes.xhtml#note",
      sectionIndex: 9,
      progression: 0.9,
      cfi: "note-cfi",
      pageLabel: "57",
    };
    fake.engine.goTo.mockImplementationOnce(async (_target, owner) => {
      fake.emit("relocate", {
        locator: note,
        chapter: "Notes",
        reason: "jump",
        atEnd: false,
        tocItem: null,
        visibleChars: 300,
        linear: false,
        paginated: true,
        navigationId: owner?.id,
      });
    });
    act(() => fake.emit("link", { href: note.href, external: false }));
    await settle();
    expect(host.querySelector("[data-reader-probe]")?.textContent).toBe("40");
    expect(host.textContent).toContain("Outside the reading order");
    expect(report).toHaveBeenCalledWith(
      "location",
      expect.objectContaining({ locator: note, percent: 40, kind: "jump" }),
    );
    expect(
      report.mock.calls.some(([name]) => name === "end" || name === "activity"),
    ).toBe(false);
    act(() => window.dispatchEvent(new Event("pagehide")));
    const saved = await persistence.committedPositions();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ state: "waiting", claim: null, mutation: {
      kind: "position", ebookId: bookId, fileId: epubId, deviceId,
      body: { fileId: epubId, locator: note },
    } });
    expect(saved[0].mutation.body.locator).toEqual(note);
    expect(saved[0].latest).toEqual(saved[0].mutation);
    expect(saved[0].mutation.createdAt).toBe(saved[0].mutation.body.clientUpdatedAt);
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });
  it("opens at this device's place, offers without a jump, and Go there emits a jump", async () => {
    await render();
    expect(fake.engine.resolve).toHaveBeenCalledWith(own.locator);
    expect(fake.engine.goTo).toHaveBeenCalledExactlyOnceWith(own.locator);
    expect(host.textContent).toContain("p. 212 · 30% ahead of you · iPhone · Safari");
    await settle();
    expect(report).toHaveBeenCalledWith(
      "location",
      expect.objectContaining({ kind: "jump", percent: 40 }),
    );
    await act(async () => button("Go there").click());
    await settle();
    expect(fake.engine.goTo).toHaveBeenCalledWith(
      other.locator,
      expect.objectContaining({ id: 1, signal: expect.any(AbortSignal) }),
    );
    expect(report).toHaveBeenCalledWith(
      "location",
      expect.objectContaining({ kind: "jump", percent: 70 }),
    );
    expect(host.textContent).not.toContain("Go there");
    expect(mocks.factory).toHaveBeenCalledOnce();
  });
  it("Stay and a page turn both dismiss the offer without remounting the engine", async () => {
    await render();
    fake.engine.goTo.mockClear();
    act(() => button("Stay").click());
    expect(fake.engine.goTo).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Go there");
    expect(
      Number(localStorage.getItem(`durtal-reader-declined:${bookId}:${deviceId}`)),
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
      fileId: pdfId,
      locator: {
        ...other.locator,
        fileHash: "b".repeat(64),
        pdf: { page: 212 },
      },
    };
    await render(own, own, pdf);
    expect(host.textContent).toContain("About 70%");
    await act(async () => button("Go there").click());
    await settle();
    expect(fake.engine.resolve).toHaveBeenLastCalledWith(pdf.locator);
    expect(fake.engine.goTo).toHaveBeenCalledWith(
      { fraction: 0.7 },
      expect.objectContaining({ id: 1, signal: expect.any(AbortSignal) }),
    );
    expect(mocks.factory).toHaveBeenCalledOnce();
  });
  it("a never-opened device starts at the other place and fades its quiet notice", async () => {
    // IndexedDB uses real Node setImmediate tasks; only the UI clock is fake.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await render(null, null, other);
    expect(fake.engine.resolve).toHaveBeenCalledWith(other.locator);
    expect(host.textContent).toContain("Your place from iPhone · Safari");
    expect(host.textContent).not.toContain("Go there");
    expect(positionReads()).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999);
    });
    expect(host.textContent).toContain("Your place from");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(host.textContent).not.toContain("Your place from");
  });
  it("keeps the opening line over the empty page until the text shows (SLN-733)", async () => {
    let show = () => {};
    Object.assign(fake.engine, {
      textHidden: () => true,
      whenTextShows: vi.fn(() => new Promise<void>((resolve) => { show = resolve; })),
    });
    await render();
    await settle();
    // Ready, with the spread still lining up behind the line
    expect(host.textContent).toContain("Opening the book");
    await act(async () => show());
    // It fades out as the text fades in
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(host.textContent).not.toContain("Opening the book");
  });
  it("saves no place for a never-opened device until the reader moves (SLN-665)", async () => {
    await render(null, null, other);
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(await persistence.committedPositions()).toEqual([]);
  });
  it("still saves a book's first open when no device has a place, so it counts as opened (SLN-683)", async () => {
    await render(null, null, null);
    await settle();
    const committed = await persistence.committedPositions();
    expect(committed).toHaveLength(1);
    expect(committed[0].mutation).toMatchObject({ kind: "position", deviceId, fileId: epubId });
  });
  it("history in another own format is not mistaken for a never-opened device", async () => {
    const pdfOwn = {
      ...own,
      fileId: pdfId,
      locator: { ...own.locator, fileHash: "b".repeat(64) },
    };
    await render(null, pdfOwn, other);
    expect(fake.engine.resolve).toHaveBeenCalledWith(pdfOwn.locator);
    expect(host.textContent).not.toContain("Opened where");
    expect(host.textContent).toContain("Go there");
  });
  it("retains the original clock and hash provenance when an own historical format is projected", async () => {
    const historical = {
      ...own,
      fileId: replacedId,
      locator: {
        ...own.locator,
        fileHash: "b".repeat(64),
        cfi: "epubcfi(old)",
        text: {
          before: "Context",
          highlight: "The paragraph I was reading",
          after: "following",
        },
      },
    };
    await render(null, historical, null);
    expect(fake.engine.resolve).toHaveBeenCalledWith(historical.locator);
    act(() => window.dispatchEvent(new Event("pagehide")));
    const committed = await persistence.committedPositions();
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ state: "waiting", claim: null, mutation: {
      kind: "position", ebookId: bookId, fileId: epubId, deviceId,
      createdAt: historical.clientUpdatedAt,
    } });
    expect(committed[0].latest).toEqual(committed[0].mutation);
    const saved = committed[0].mutation.body;
    expect(saved).toMatchObject({
      fileId: epubId,
      clientUpdatedAt: historical.clientUpdatedAt,
      locator: { fileHash: "a".repeat(64), totalProgression: 0.4 },
    });
    expect(historical.locator.fileHash).toBe("b".repeat(64));
    expect(historical.locator.cfi).toBe("epubcfi(old)");
    expect(report.mock.calls.filter(([name]) => ["activity", "end"].includes(name))).toEqual([]);
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });
  it("does not override a local turn made while the offered quote is resolving", async () => {
    await render();
    fake.engine.goTo.mockClear();
    let finish!: (result: import("@/lib/reader/engine").ResolveResult) => void;
    fake.engine.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => button("Go there").click());
    pressRight();
    await settle();
    await act(async () => {
      finish({ status: "exact", locator: other.locator });
    });
    expect(fake.engine.goTo).not.toHaveBeenCalled();
    expect(fake.engine.currentLocator()?.totalProgression).toBe(0.5);
    expect(host.textContent).toContain("Your place changed");
  });
  it("discards a response after a local turn while a refresh GET is pending", async () => {
    // Existing SLN-493 polling cancellation remains unchanged.
    await render();
    let finish!: (value: Response) => void;
    const ordinaryFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, options) => {
      const path = new URL(input instanceof Request ? input.url : String(input), "http://fixture.invalid").pathname;
      if (path === `/api/reader/${bookId}/position` && (options?.method ?? "GET") === "GET")
        return new Promise<Response>(resolve => { finish = resolve; });
      return ordinaryFetch(input, options);
    });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    await persistence.waitFor(() => positionReads().length === 1, "the refresh position GET");
    expect(positionReads()).toHaveLength(1);
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
    await persistence.settle();
    expect(positionReads()).toHaveLength(0);
    await state("hidden");
    now = 120999;
    await state("visible");
    await persistence.waitFor(() => positionReads().length === 1, "the sixty-second visibility refresh GET");
    expect(positionReads()).toHaveLength(1);
    expect(positionReads()[0][1]).toEqual({ cache: "no-store" });
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
  it("allows second Tab, both plugin actions and exit after keyboard selection entry", async () => {
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
    const tabFrom = (target: EventTarget) => {
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      act(() => target.dispatchEvent(event));
      return event;
    };
    expect(tabFrom(doc).defaultPrevented).toBe(true);
    const copy = button("Copy");
    expect(document.activeElement).toBe(copy);
    expect(tabFrom(copy).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(copy);
    const actions = [button("Plugin action one"), button("Plugin action two")];
    const lookup = host.querySelector<HTMLButtonElement>(
      '[role="toolbar"] button[aria-label="Look up"]',
    )!;
    expect(lookup).not.toBeNull();
    expect(lookup.disabled).toBe(false);
    expect(lookup.tabIndex).toBe(0);
    expect([
      ...host.querySelector('[role="toolbar"]')!.querySelectorAll("button"),
    ]).toEqual([copy, ...actions, lookup]);
    // Lookup fills the final selection-actions slot after both plugin buttons.
    // happy-dom has no native Tab default action. Move focus as the browser
    // would, then prove the reader neither cancels traversal nor refocuses Copy.
    for (const action of [...actions, lookup]) {
      action.focus();
      expect(tabFrom(action).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(action);
    }
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      outside.focus();
      expect(tabFrom(outside).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
    expect(fake.engine.clearSelection).not.toHaveBeenCalled();
  });
});

it("mounted speech saves a painted location without tracker activity, pace events or completion", async () => {
  class Utterance extends EventTarget {
    lang = "";
    rate = 1;
    voice: SpeechSynthesisVoice | null = null;
    constructor(public text: string) {
      super();
    }
  }
  const platform = Object.assign(new EventTarget(), {
    paused: false,
    getVoices: () =>
      [
        {
          voiceURI: "en",
          name: "English",
          lang: "en",
          localService: true,
          default: true,
        },
      ] as SpeechSynthesisVoice[],
    speak: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
  });
  vi.stubGlobal("speechSynthesis", platform);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    callback();
    return 1;
  });
  const reader: import("@/lib/reader/engine").ReaderEngine = fake.engine;
  const current = {
    text: "A real prepared sentence.",
    lang: "en",
    locator: {
      ...own.locator,
      cfi: "speech-sentence",
      progression: 0.9,
      totalProgression: 0.9,
    },
  };
  reader.prepareSpeech = vi.fn(async () => ({
    current,
    previous: null,
    next: null,
  }));
  fake.engine.goTo.mockImplementation(async (target, owner) => {
    if (!("v" in target)) return;
    fake.emit("relocate", {
      locator: target,
      chapter: "Speech chapter",
      reason: "jump",
      origin: owner?.origin,
      navigationId: owner?.id,
      atEnd: true,
      activity: "turn",
      tocItem: null,
      visibleChars: 300,
      linear: true,
      paginated: true,
    });
  });
  expect(window.speechSynthesis).toBe(platform);
  expect(window.SpeechSynthesisUtterance).toBe(Utterance);
  await render();
  await settle();
  // Separate act boundaries let the real lazy module and React's reveal commit.
  for (
    let n = 0;
    n < 40 && !host.querySelector('button[aria-label="Read aloud"]');
    n++
  )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  const start = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Read aloud"]',
  )!;
  expect(reader.prepareSpeech).toHaveBeenCalled();
  expect(start).not.toBeNull();
  expect(start.disabled).toBe(false);
  expect(platform.speak).not.toHaveBeenCalled();
  report.mockClear();
  act(() => start.click());
  expect(platform.speak).toHaveBeenCalledOnce();
  const top = host.querySelector("header")!,
    book = host.querySelector("#reader-book")!,
    player = host.querySelector("[data-speech-player]")!,
    bottom = host.querySelector("[data-reader-bottom-bar]")!;
  expect(
    top.compareDocumentPosition(book) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    book.compareDocumentPosition(player) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    player.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect((platform.speak.mock.calls[0][0] as Utterance).text).toBe(
    current.text,
  );
  act(() =>
    (platform.speak.mock.calls[0][0] as Utterance).dispatchEvent(
      new Event("start"),
    ),
  );
  await settle();
  expect(host.querySelector("[data-reader-probe]")!.textContent).toBe("90");
  expect(
    report.mock.calls.filter(([name]) =>
      ["activity", "location", "end"].includes(name),
    ),
  ).toEqual([]);
  act(() => window.dispatchEvent(new Event("pagehide")));
  const committed = await persistence.committedPositions();
  expect(committed).toHaveLength(1);
  expect(committed[0]).toMatchObject({ state: "waiting", claim: null, mutation: {
    kind: "position", ebookId: bookId, fileId: epubId, deviceId,
    body: { fileId: epubId, locator: current.locator, chapter: "Speech chapter" },
  } });
  expect(committed[0].mutation.body.locator).toEqual(current.locator);
  expect(committed[0].latest).toEqual(committed[0].mutation);
  expect(localStorage.getItem("durtal-reader-pace")).toBeNull();
  expect(committed[0].mutation.body.locator.cfi).toBe("speech-sentence");
  expect(committed[0].mutation.createdAt).toBe(committed[0].mutation.body.clientUpdatedAt);
  expect(navigator.sendBeacon).not.toHaveBeenCalled();
});

it("puts Skip to the book before top-bar controls and delegates focus to the actual engine", async () => {
  const reader: import("@/lib/reader/engine").ReaderEngine = fake.engine;
  const focus = vi.fn();
  reader.focusBook = focus;
  await render();
  const first = host.querySelector<HTMLAnchorElement>("a")!;
  expect(first.textContent).toBe("Skip to the book");
  act(() => first.click());
  expect(focus).toHaveBeenCalledOnce();
});

it.each(["valid", "malformed"] as const)("lifecycle replay retains exact intent until a %s acknowledgement", async acknowledgement => {
  await render(); await settle();
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  await settle();
  const original = await persistence.committedPositions();
  expect(original).toHaveLength(1);
  expect(original[0].latest).toEqual(original[0].mutation);
  let release!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { release = resolve; });
  const posts: RequestInit[] = [];
  vi.mocked(fetch).mockImplementation(async (input, options) => {
    const path = new URL(input instanceof Request ? input.url : String(input), "http://fixture.invalid").pathname;
    if (path === "/api/reader/device" && (options?.method ?? "GET") === "GET")
      return new Response(JSON.stringify({ deviceId }), { headers: { "content-type": "application/json" } });
    if (path === `/api/reader/${bookId}/position` && options?.method === "POST") {
      posts.push(options); return response;
    }
    if (path === `/api/reader/${bookId}/annotations` && (options?.method ?? "GET") === "GET")
      return new Response(JSON.stringify({ annotations: [], serverTime: "2026-10-09T11:00:00Z", reset: false }), { headers: { "content-type": "application/json" } });
    if (path === `/api/reader/${bookId}/position` && (options?.method ?? "GET") === "GET")
      return new Response(JSON.stringify({ positions: [other] }), { headers: { "content-type": "application/json" } });
    throw new Error(`Unexpected reader fixture request: ${path}`);
  });
  persistence.setReachable(true);
  let flight!: Promise<void>;
  try {
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      flight = persistence.runtime.requestReplay("lifecycle");
      await vi.waitFor(() => expect(posts).toHaveLength(1));
    });
    expect(posts[0].keepalive).toBe(true);
    expect(new Headers(posts[0].headers).get(EXPECTED_DEVICE_HEADER)).toBe(deviceId);
    expect(posts[0].body).toBe(mutationWireJson(original[0].mutation));
    const claimed = await persistence.committedPositions();
    expect(claimed).toHaveLength(1); expect(claimed[0].state).toBe("claimed");
    expect(claimed[0].mutation).toEqual(original[0].mutation);
    const reply = acknowledgement === "valid" ? { saved: true, position: original[0].mutation.body } : { saved: true };
    await act(async () => { release(new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } })); await flight; });
    const after = await persistence.committedPositions();
    if (acknowledgement === "valid") {
      expect(after).toEqual([]);
      const local = await persistence.snapshot(`${bookId}:${epubId}:${deviceId}`);
      expect(local.position?.latest).toEqual(original[0].mutation);
    } else {
      expect(after).toHaveLength(1); expect(after[0].state).toBe("waiting");
      expect(after[0].mutation).toEqual(original[0].mutation);
      expect(after[0].latest).toEqual(original[0].mutation);
    }
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  } finally {
    release(new Response("{}", { headers: { "content-type": "application/json" } }));
    persistence.setReachable(false);
    if (flight) await flight;
  }
});

it.each(["pending", "rejected"])("opens the downloaded reader engine while onLine is true and adoption is %s", async kind => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const scope: PreferenceScope = { deviceClass: classifyDevice({ width: window.screen.width, height: window.screen.height,
    coarse: window.matchMedia("(pointer: coarse)").matches }), ebookId: bookId };
  const cached = serializePreferenceCache(scope, [{ ...scope, presentation: { fontSizePx: 28 } }]);
  window.localStorage.setItem(preferenceCacheKey(scope), cached);
  document.cookie = `${READER_SETTINGS_KEY}=kept; Path=/`;
  let release!: (reply: PreferenceReply) => void;
  const pending = new Promise<PreferenceReply>(done => { release = done; });
  mocks.adopt.mockImplementationOnce(() => kind === "pending" ? pending : Promise.reject(new Error("Origin unreachable.")));
  await render(null, null, null, true);
  expect(mocks.adopt).toHaveBeenCalledTimes(1);
  expect(mocks.factory).toHaveBeenCalledTimes(1); expect(fake.engine.open).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-reader="ready"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Origin unreachable.");
  expect(window.localStorage.getItem(preferenceCacheKey(scope))).toBe(cached);
  expect(document.cookie).toContain(`${READER_SETTINGS_KEY}=kept`);
  // Finish the held transport only after actual engine admission has been observed.
  if (kind === "pending") {
    await act(async () => { release({ ok: true, ...scope, rows: [] }); });
    await settle();
  }
  document.cookie = `${READER_SETTINGS_KEY}=; Path=/; Max-Age=0`;
});
