// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderBridgeProvider } from "@/components/reader/bridge";
import { SelectionToolbar } from "@/components/reader/selection-toolbar";
import { LookupLayer } from "@/components/reader/lookup/lookup-layer";
import { fakeEngine } from "../fixtures/fake-engine";
import type { SelectionDetails, EngineEvents } from "@/lib/reader/engine";
import { defaultLookupSettings } from "@/lib/reader/lookup/sources";
import { readLocalLookupSettings, writeLocalLookupSettings } from "@/lib/reader/lookup/preferences";
import { createReaderInput, type ReaderActions } from "@/lib/reader/input";
const calls = vi.hoisted(() => ({
  dictionary: vi.fn(), wikipedia: vi.fn(), list: vi.fn(), historyAdd: vi.fn(), historyLanguage: vi.fn(),
  settings: vi.fn(), workerClose: vi.fn(),
}));
vi.mock("@/lib/actions/reader-lookup", () => ({ getLookupSettings: calls.settings }));
vi.mock("@/lib/reader/lookup/wiktionary", () => ({ lookupWiktionary: calls.dictionary }));
vi.mock("@/lib/reader/lookup/wikipedia", () => ({ lookupWikipedia: calls.wikipedia }));
vi.mock("@/lib/reader/lookup/pack-store", () => ({ browserPackStore: () => ({ list: calls.list, close() {} }) }));
vi.mock("@/lib/reader/lookup/packs", () => ({ LookupPacksClient: class { close = calls.workerClose; lookup = vi.fn(async () => []); } }));
vi.mock("@/lib/reader/lookup/history", () => ({
  browserLookupHistoryStore: () => ({ add: calls.historyAdd, updateLanguage: calls.historyLanguage, close() {} }),
  recordLookupHistory: (store: { add(input: unknown): Promise<number> }, input: unknown) => store.add(input),
}));
let root: Root, host: HTMLDivElement, frames: FrameRequestCallback[];
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); frames = [];
  calls.settings.mockResolvedValue(defaultLookupSettings());
  calls.historyAdd.mockResolvedValue(1); calls.historyLanguage.mockResolvedValue(undefined);
  calls.list.mockResolvedValue([]);
  calls.dictionary.mockImplementation(async (_lang, _words, _signal, _client, updates) => {
    const english = { status: "fulfilled", value: { word: "lux", format: "definitions", found: true,
      sections: [{ code: "la", language: "Latin", partOfSpeech: "noun", definitions: [{ html: "<p>synthetic gloss</p>", examples: [] }] }] } };
    const own = { status: "fulfilled", value: null };
    updates.english(english); updates.own(own); return { english, own };
  });
  calls.wikipedia.mockResolvedValue({ found: false, error: null });
  Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value() {} });
  Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function paint() {
  const batch = frames.splice(0); await act(async () => { batch.forEach(callback => callback(performance.now())); await Promise.resolve(); });
}
function mount() {
  const fake = fakeEngine(), toolbar = { current: null as HTMLDivElement | null };
  const details: SelectionDetails = { text: "lux", sentence: "Lux lucet.", lang: "la", rect: new DOMRectReadOnly(100, 100, 20, 20),
    locator: { v: 1, fileHash: "a".repeat(64), href: "chapter", sectionIndex: 0, progression: 0, totalProgression: 0 } };
  fake.engine.selectionDetails.mockReturnValue(details);
  fake.engine.focusBook = vi.fn();
  act(() => root.render(h(ReaderBridgeProvider, {
    context: { ebookId: "467ab36f-bbd0-4807-8e37-abdf0f6b9577", fileId: "file", format: "epub", selection: null, chapter: null, percent: null, locator: null }, plugins: [],
    children: bridge => h("div", null,
      h(SelectionToolbar, { ref: toolbar, bridge, selection: null, onClear() {} }),
      h(LookupLayer, { engine: fake.engine, ebook: { id: "467ab36f-bbd0-4807-8e37-abdf0f6b9577", title: "Synthetic", language: "en" }, toolbarRef: toolbar })),
  })));
  return { fake, details, toolbar };
}
describe("mounted lookup acquisition/lifecycle source (mock providers, not native proof)", () => {
  it("keeps validated local lookup settings offline without starting a settings action", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const local = { ...defaultLookupSettings(), translateTo: "es" };
    writeLocalLookupSettings(local);
    mount();
    expect(calls.settings).not.toHaveBeenCalled();
    await paint(); await paint();
    act(() => window.dispatchEvent(new Event("online")));
    expect(calls.settings).not.toHaveBeenCalled();
    expect(readLocalLookupSettings()).toEqual(local);
  });
  it("waits for first paint even if connectivity returns before the deferred frame", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mount();
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(calls.settings).not.toHaveBeenCalled();
    await paint();
    expect(calls.settings).not.toHaveBeenCalled();
    await paint();
    expect(calls.settings).toHaveBeenCalledOnce();
  });
  it("reconciles an offline opening once when the browser becomes online", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const local = { ...defaultLookupSettings(), translateTo: "es" };
    const remote = { ...defaultLookupSettings(), translateTo: "fr" };
    writeLocalLookupSettings(local); calls.settings.mockResolvedValue(remote);
    mount(); await paint(); await paint();
    expect(calls.settings).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
    expect(calls.settings).toHaveBeenCalledOnce();
    expect(readLocalLookupSettings()).toEqual(remote);
    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
    expect(calls.settings).toHaveBeenCalledOnce();
  });
  it("preserves local edits made while a reconnect settings read is pending", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const remote = { ...defaultLookupSettings(), translateTo: "fr" };
    let finish!: (value: ReturnType<typeof defaultLookupSettings>) => void;
    calls.settings.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount(); await paint(); await paint();
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(calls.settings).toHaveBeenCalledOnce();
    const edited = { ...defaultLookupSettings(), translateTo: "de" };
    act(() => writeLocalLookupSettings(edited));
    await act(async () => { finish(remote); await Promise.resolve(); });
    expect(readLocalLookupSettings()).toEqual(edited);
  });
  it("removes a deferred offline settings acquisition when the reader unmounts", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const local = { ...defaultLookupSettings(), translateTo: "es" };
    writeLocalLookupSettings(local);
    mount(); await paint(); await paint();
    act(() => root.render(null));
    online.mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
    expect(calls.settings).not.toHaveBeenCalled();
    expect(readLocalLookupSettings()).toEqual(local);
  });
  it("gesture paints skeleton before any provider call and records only browser history", async () => {
    const { fake, details } = mount();
    act(() => fake.emit("word-gesture", { details }));
    expect(host.querySelector('[aria-label="Look up lux"]')).not.toBeNull();
    expect(host.querySelector("[data-lookup-skeleton]")).not.toBeNull();
    expect(calls.dictionary).not.toHaveBeenCalled(); expect(calls.wikipedia).not.toHaveBeenCalled();
    expect(calls.historyAdd).toHaveBeenCalledWith(expect.objectContaining({ word: "lux", language: "la", sentence: "Lux lucet." }));
    await paint(); await paint();
    expect(calls.dictionary).toHaveBeenCalledWith("la", ["lux"], expect.any(AbortSignal), undefined, expect.any(Object));
    expect(host.textContent).toContain("synthetic gloss");
    expect(host.textContent).toContain("CC BY-SA 4.0");
  });
  it("a replacement and relocation cancel the old provider generation", async () => {
    calls.dictionary.mockImplementation(() => new Promise(() => {}));
    const { fake, details } = mount(); act(() => fake.emit("word-gesture", { details }));
    await paint(); await paint();
    const old = calls.dictionary.mock.calls[0][2] as AbortSignal;
    act(() => fake.emit("word-gesture", { details: { ...details, text: "domus" } }));
    expect(old.aborted).toBe(true);
    await paint(); await paint();
    const next = calls.dictionary.mock.calls[1][2] as AbortSignal;
    act(() => fake.emit("relocate", { locator: details.locator, chapter: null, reason: "turn", atEnd: false, tocItem: null,
      visibleChars: 10, linear: true, paginated: true } satisfies EngineEvents["relocate"]));
    expect(next.aborted).toBe(true); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it("d is inactive without selection, opens with selection, and Escape returns to the book", () => {
    const { fake, details } = mount();
    const methods = ["next", "prev", "left", "right", "first", "last", "toggleBars", "contents", "settings", "fullscreen", "escape"];
    const actions = Object.fromEntries(methods.map(name => [name, vi.fn()])) as unknown as ReaderActions;
    let selected = false;
    const input = createReaderInput({ actions, isBlocked: () => false, hasSelection: () => selected });
    input.attach(document);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    selected = true;
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true })));
    expect(host.querySelector('[aria-label="Look up lux"]')).not.toBeNull();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(fake.engine.focusBook).toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).toBeNull(); input.destroy();
    expect(details.lang).toBe("la");
  });
});
