// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement as h, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";

const control = vi.hoisted(() => {
  let reject!: (error: Error) => void;
  const wait = new Promise<void>((_, no) => { reject = no; });
  let finishPast!: () => void;
  let finishNote!: () => void;
  const past = new Promise<void>((yes) => { finishPast = yes; });
  const note = new Promise<void>((yes) => { finishNote = yes; });
  return { wait, reject, loads: 0, past, note, finishPast, finishNote };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/actions/reading", () => ({
  getReadingDialogData: vi.fn(async () => ({ workId: "one", workTitle: "One", homes: [], rows: [] })),
  pauseReading: vi.fn(), resumeReading: vi.fn(),
}));
vi.mock("@/components/reading/book-picker", () => ({ BookPicker: () => null }));
vi.mock("@/components/reading/dialogs/start-reading-dialog", async () => {
  control.loads++;
  if (control.loads === 1) await control.wait;
  return { StartReadingDialog: () => h("dialog", { open: true, "data-recovered": "" }, "Recovered start dialog") };
});
vi.mock("@/components/reading/dialogs/past-read-dialog", async () => {
  await control.past;
  return { PastReadDialog: () => h("dialog", { open: true, "data-late-past": "" }, "Past dialog") };
});
vi.mock("@/components/reading/dialogs/note-dialog", async () => {
  await control.note;
  return { NoteDialog: () => h("dialog", { open: true, "data-late-note": "" }, "Note dialog") };
});
import { ReadingDialogsProvider, useReadingDialogs } from "@/components/reading/reading-dialogs-provider";
import { hasOpenSurface } from "@/lib/ui/surface-state";
let dialogs: ReturnType<typeof useReadingDialogs>;
function Consumer() { dialogs = useReadingDialogs(); return h("p", null, "Reader remains available"); }
let root: Root | null = null;
let host: HTMLElement;
let opener: HTMLButtonElement;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.spyOn(console, "error").mockImplementation(() => {});
  opener = document.createElement("button"); document.body.append(opener); opener.focus();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(h(Suspense, { fallback: h("p", { "data-segment-fallback": "" }, "Outer segment fallback") }, h(ReadingDialogsProvider, { children: h(Consumer) }))));
});
afterEach(() => {
  act(() => root?.unmount());
  expect(hasOpenSurface()).toBe(false);
  host?.remove(); opener?.remove(); vi.restoreAllMocks();
});
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); }
async function open(kind: "start" | "past" | "note") {
  await act(async () => { await dialogs.open({ kind, workId: "one" }); });
  await settle();
}
async function escape() {
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
}
it("keeps the native pending surface until the individual dialog loads and retries its failed module", async () => {
  const book = host.querySelector("p");
  await open("start");
  expect(host.querySelector('dialog[aria-label="Loading reading action"][open]'), host.innerHTML).not.toBeNull();
  await act(async () => { control.reject(new Error("Individual dialog chunk failed")); await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(host.querySelector('dialog[aria-label="Reading action unavailable"]')).not.toBeNull();
  await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click(); await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(control.loads, "Retry must invoke a new individual renderer load").toBe(2);
  expect(host.querySelector("[data-recovered]"), host.innerHTML).not.toBeNull();
  expect(host.querySelector("p")).toBe(book);
  expect(host.querySelector("[data-segment-fallback]")).toBeNull();
  await escape();
  expect(hasOpenSurface()).toBe(false);
  expect(document.activeElement).toBe(opener);
});
it("does not resurrect a dismissed dialog when its individual module resolves", async () => {
  await open("past");
  expect(host.querySelector('dialog[aria-label="Loading reading action"][open]')).not.toBeNull();
  await escape();
  expect(hasOpenSurface()).toBe(false);
  expect(document.activeElement).toBe(opener);
  await act(async () => { control.finishPast(); }); await settle();
  expect(host.querySelector("dialog")).toBeNull();
  expect(hasOpenSurface()).toBe(false);
});
it("does not replace the current dialog with an older module completion", async () => {
  const book = host.querySelector("p");
  await open("note");
  expect(host.querySelector('dialog[aria-label="Loading reading action"][open]')).not.toBeNull();
  await open("start");
  const current = host.querySelector("[data-recovered]");
  expect(current).not.toBeNull();
  await act(async () => { control.finishNote(); }); await settle();
  expect(host.querySelector("[data-late-note]")).toBeNull();
  expect(host.querySelector("[data-recovered]")).toBe(current);
  expect(host.querySelector("p")).toBe(book);
  expect(hasOpenSurface()).toBe(true);
  await escape();
  expect(hasOpenSurface()).toBe(false);
  expect(document.activeElement).toBe(opener);
});
