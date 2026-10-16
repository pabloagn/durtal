// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// A button that writes waits for its write (task 0760): Save anyway in Log a
// past read, Pause instead in Abandon and Undo in Hidden suggestions are busy
// while their write runs, so a double press writes once.

const pending = vi.hoisted(() => ({ release: () => {} }));
/** A write that returns only when the test lets it */
const held = <T,>(value: T) =>
  new Promise<T>((resolve) => {
    pending.release = () => resolve(value);
  });
const actions = vi.hoisted(() => ({
  addPastReading: vi.fn(),
  abandonReading: vi.fn(),
  pauseReading: vi.fn(),
  reopenReading: vi.fn(),
}));
const suggestions = vi.hoisted(() => ({
  removeSuggestionFeedback: vi.fn(),
  restoreSuggestionFeedback: vi.fn(),
}));
vi.mock("@/lib/actions/reading", () => actions);
vi.mock("@/lib/actions/suggestions", () => suggestions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/notifications/toast", () => {
  const push = () => {};
  return { toast: Object.assign(push, { success: push, error: push, message: push, info: push }) };
});
vi.mock("@/components/shared/tiptap-editor", () => ({
  TiptapEditor: () => createElement("div", { "data-editor": "" }),
}));

import { PastReadDialog } from "@/components/reading/dialogs/past-read-dialog";
import { AbandonReadingDialog } from "@/components/reading/dialogs/abandon-reading-dialog";
import { HiddenList } from "@/components/reading/suggestions/hidden-list";
import type { ReadingDialogProps } from "@/components/reading/reading-provider";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute("open", "");
  };
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  Object.values(actions).forEach((fn) => fn.mockReset());
  Object.values(suggestions).forEach((fn) => fn.mockReset());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const reading = {
  id: "r1",
  workId: "w1",
  status: "reading",
  unit: "pages",
  totalPages: 480,
  currentPage: 40,
  currentPercent: 8.33,
  startedOn: "2019-04-14",
  startedPrecision: "day",
};
const row = { reading, fingerprint: "a".repeat(32) };
const data = { workId: "w1", workTitle: "Watt", dayStartHour: 4, rows: [row], editions: [], homes: [] };
function props(over: Partial<ReadingDialogProps> = {}): ReadingDialogProps {
  return {
    data: data as never,
    row: row as never,
    request: { kind: "abandon", readingId: "r1" },
    home: "",
    setHome: () => {},
    onClose: () => {},
    changed: () => {},
    open: () => {},
    ...over,
  };
}
const button = (label: string) =>
  [...host.ownerDocument.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const press = (label: string) => act(async () => button(label).click());

describe("Log a past read", () => {
  it("logs the read once when Save anyway is pressed twice", async () => {
    actions.addPastReading.mockResolvedValueOnce({ outcome: "possible_duplicate", message: "You may have logged this read" });
    act(() => root.render(createElement(PastReadDialog, props({ row: null, request: { kind: "past" } as never }))));
    await press("Log read");
    expect(button("Save anyway")).toBeTruthy();

    actions.addPastReading.mockImplementationOnce(() => held({ outcome: "created" }));
    await press("Save anyway");
    expect(button("Save anyway").disabled).toBe(true);
    expect(button("Save anyway").getAttribute("aria-busy")).toBe("true");
    await press("Save anyway");
    expect(actions.addPastReading).toHaveBeenCalledTimes(2);
    expect(actions.addPastReading.mock.calls[1][0]).toMatchObject({ allowPossibleDuplicate: true });
    await act(async () => pending.release());
  });
});

describe("Abandon", () => {
  it("pauses once, and holds Abandon, while Pause instead runs", async () => {
    actions.pauseReading.mockImplementation(() => held({}));
    act(() => root.render(createElement(AbandonReadingDialog, props())));
    await press("Pause instead");
    expect(button("Pause instead").getAttribute("aria-busy")).toBe("true");
    expect(button("Abandon").disabled).toBe(true);
    await press("Pause instead");
    await act(async () => {
      host.ownerDocument.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(actions.pauseReading).toHaveBeenCalledTimes(1);
    expect(actions.abandonReading).not.toHaveBeenCalled();
    await act(async () => pending.release());
  });

  it("holds Pause instead while Abandon saves", async () => {
    actions.abandonReading.mockImplementation(() => held({ reading: { fingerprint: "b".repeat(32) }, undo: {} }));
    act(() => root.render(createElement(AbandonReadingDialog, props())));
    await act(async () => {
      host.ownerDocument.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(button("Pause instead").disabled).toBe(true);
    await press("Pause instead");
    expect(actions.pauseReading).not.toHaveBeenCalled();
    await act(async () => pending.release());
  });
});

describe("Hidden suggestions", () => {
  const rows = [
    { workId: "w1", title: "Watt", href: "/library/watt", author: null, cover: null, verdict: "Never", note: null, date: "Hidden on 5 Oct" },
    { workId: "w2", title: "Molloy", href: "/library/molloy", author: null, cover: null, verdict: "Never", note: null, date: "Hidden on 5 Oct" },
  ];
  const undo = (workId: string) => host.ownerDocument.querySelector<HTMLButtonElement>(`[data-hidden-undo="${workId}"]`)!;

  it("runs Undo once on a double press, and only that row waits", async () => {
    suggestions.removeSuggestionFeedback.mockImplementation(() => held({ workId: "w1" }));
    act(() => root.render(createElement(HiddenList, { rows })));
    await act(async () => undo("w1").click());
    expect(undo("w1").getAttribute("aria-busy")).toBe("true");
    expect(undo("w2").disabled).toBe(false);
    await act(async () => undo("w1").click());
    expect(suggestions.removeSuggestionFeedback).toHaveBeenCalledTimes(1);
    await act(async () => pending.release());
    // The row stays busy until the refresh takes it away
    expect(undo("w1").disabled).toBe(true);
    act(() => root.render(createElement(HiddenList, { rows: rows.slice(1) })));
    // Brought back by the toast's Undo, it can be pressed again
    act(() => root.render(createElement(HiddenList, { rows })));
    expect(undo("w1").disabled).toBe(false);
  });

  it("frees the row when the write fails", async () => {
    suggestions.removeSuggestionFeedback.mockRejectedValue(new Error("offline"));
    act(() => root.render(createElement(HiddenList, { rows })));
    await act(async () => undo("w1").click());
    expect(undo("w1").disabled).toBe(false);
  });
});
