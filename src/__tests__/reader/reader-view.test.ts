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
vi.mock("@/components/reader/settings-dialog", () => ({
  SettingsDialog: () => null,
}));
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
import { ReaderSlotFill } from "@/components/reader/bridge";
// EB Garamond loads through next/font, which needs the Next compiler.
vi.mock("next/font/google", () => ({ EB_Garamond: () => ({ variable: "font-prose" }) }));
import { ReaderView } from "@/app/reader/[ebookId]/reader-view";
import type { ReaderPlace } from "@/lib/reader/sync/places";
import { place } from "./fixtures/places";
import { fakeEngine } from "./fixtures/fake-engine";
import { ProbePlugin } from "./fixtures/probe-plugin";
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
      async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        const body = url.includes("/annotations")
          ? { annotations: [], serverTime: "2026-10-09T11:00:00Z", reset: false }
          : { positions: [other] };
        return new Response(JSON.stringify(body), {
          status: 200, headers: { "content-type": "application/json" },
        });
      },
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
        plugins: [
          { id: "probe", node: h(ProbePlugin, { data: { report } }) },
          { id: "actions", node: h(ToolbarActions) },
        ],
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
    },
  );
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
    const body = vi.mocked(navigator.sendBeacon).mock.calls.at(-1)?.[1] as Blob;
    expect(JSON.parse(await body.text()).locator).toEqual(note);
  });
  it("opens at this device's place, offers without a jump, and Go there emits a jump", async () => {
    await render();
    expect(fake.engine.resolve).toHaveBeenCalledWith(own.locator);
    expect(fake.engine.goTo).toHaveBeenCalledExactlyOnceWith(own.locator);
    expect(host.textContent).toContain("Page 212 · read on iPhone");
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
    vi.useFakeTimers();
    await render(null, null, other);
    expect(fake.engine.resolve).toHaveBeenCalledWith(other.locator);
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
    const body = vi.mocked(navigator.sendBeacon).mock.calls.at(-1)?.[1] as Blob;
    const saved = JSON.parse(await body.text());
    expect(saved).toMatchObject({
      fileId: epubId,
      clientUpdatedAt: historical.clientUpdatedAt,
      locator: { fileHash: "a".repeat(64), totalProgression: 0.4 },
    });
    expect(historical.locator.fileHash).toBe("b".repeat(64));
    expect(historical.locator.cfi).toBe("epubcfi(old)");
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
    expect([
      ...host.querySelector('[role="toolbar"]')!.querySelectorAll("button"),
    ]).toEqual([copy, ...actions]);
    // happy-dom has no native Tab default action. Move focus as the browser
    // would, then prove the reader neither cancels traversal nor refocuses Copy.
    for (const action of actions) {
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
  const beacon = vi.mocked(navigator.sendBeacon).mock.calls.at(-1)!;
  expect(JSON.parse(await (beacon[1] as Blob).text()).locator.cfi).toBe(
    "speech-sentence",
  );
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
