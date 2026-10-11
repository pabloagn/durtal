// @vitest-environment happy-dom
// Real mounted tracker/bridge and post-save annotation refresh. Server actions,
// native rendering and dialogs are fixtures; no database/browser proof claimed.
import { act, createElement as h, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderBridgeProvider } from "@/components/reader/bridge";
import { SelectionToolbar } from "@/components/reader/selection-toolbar";
import { ReaderTracking, ReaderTrackingFailure } from "@/components/reading/reader-tracking";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { ReaderSelection } from "@/lib/reader/events";
import { subscribeAnnotationServerChanges } from "@/lib/reader/annotation-server-changes";
import { id, locator } from "./fixtures/annotation";

const actions = vi.hoisted(() => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("@/lib/actions/reader-tracking", () => ({ saveReaderQuote: actions.save,
  getReaderTracking: vi.fn(), prepareReaderQuoteDelete: vi.fn(), startReaderReading: vi.fn() }));
vi.mock("@/lib/actions/reading", () => ({ deleteReading: vi.fn(), pauseReading: vi.fn(), resumeReading: vi.fn() }));
vi.mock("@/components/reading/timer-provider", () => ({ useOptionalTimer: () => ({ availability: "ready", timer: null }) }));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({ open: actions.open }) }));

const word: ReaderSelection = { text: "Table", locator, fileId: id(3), chapter: null, percent: 44 };
const paragraph: ReaderSelection = { ...word, text: "Table by the door, where the widow waited.",
  locator: { ...locator, cfi: locator.cfi.replace("/1:16)", "/1:43)"),
    text: { ...locator.text, highlight: "Table by the door, where the widow waited." } } };
let native: ReaderSelection | null, root: Root, host: HTMLElement, bridge: ReaderBridgeController;
let unsubscribe: () => void;
function Toolbar({ owner }: { owner: ReaderBridgeController }) {
  useLayoutEffect(() => owner.registerSelectionCapture(() => native ? { selection: native, clear() {} } : null), [owner]);
  return h(SelectionToolbar, { bridge: owner, selection: { text: word.text, locator: word.locator,
    rect: { left: 0, right: 100, top: 0, bottom: 20 }, keyboard: false }, onClear() {} });
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear(); native = word;
  actions.save.mockResolvedValue({ note: { id: id(9) } }); actions.open.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => {
    root.render(h(ReaderBridgeProvider, { context: { ebookId: id(2), fileId: id(3), format: "epub",
      locator, percent: 44, chapter: null, selection: word }, requiredControllerIds: ["reading-tracker"],
      plugins: [{ id: "reading-tracker", controller: true, failureNode: h(ReaderTrackingFailure, { id: "reading-tracker", code: "reader_controller_failed" }),
        node: h(ReaderTracking, { data: { version: 1, ebookId: id(2), deviceId: id(4), autoTrack: false,
          dayStartHour: 4, estimate: null, linked: { workId: id(5), title: "Selection test", editionId: id(6),
            instanceId: id(7), hasClosedHistory: false, reading: null } } }) }],
      children: owner => { bridge = owner; return h(Toolbar, { owner }); } }));
  });
  expect(bridge.getControllerReadinessSnapshot().ready).toBe(true);
  unsubscribe = () => {};
});
afterEach(async () => { unsubscribe(); await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); });
const quoteButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Save quote")!;
describe("quote action-time selection", () => {
  it("saves the current paragraph despite a published word, then refreshes annotations before opening the note", async () => {
    const order: string[] = [];
    actions.save.mockImplementation(async () => { order.push("save"); return { note: { id: id(9) } }; });
    unsubscribe = subscribeAnnotationServerChanges(id(2), async () => { order.push("refresh"); });
    actions.open.mockImplementation(async () => { order.push("open"); });
    native = paragraph;
    await act(async () => { quoteButton().click(); });
    expect(actions.save).toHaveBeenCalledExactlyOnceWith({ ebookId: id(2), ...paragraph });
    expect(order).toEqual(["save", "refresh", "open"]);
  });
  it("does not save a stale displayed selection after the native range has collapsed", async () => {
    native = null; await act(async () => { quoteButton().click(); });
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("keeps the original submitted quote but does not open a note after bridge revocation", async () => {
    let release!: (value: { note: { id: string } }) => void;
    actions.save.mockImplementation(() => new Promise(done => { release = done; }));
    native = paragraph;
    await act(async () => { quoteButton().click(); });
    expect(actions.save).toHaveBeenCalledExactlyOnceWith({ ebookId: id(2), ...paragraph });
    bridge.destroy();
    await act(async () => { release({ note: { id: id(9) } }); });
    expect(actions.open).not.toHaveBeenCalled();
  });
});
