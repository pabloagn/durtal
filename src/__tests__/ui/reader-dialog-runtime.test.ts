// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { PreferencesProvider, usePreference } from "@/lib/hooks/use-preference";
import type { ReadingDialogHostProps } from "@/components/reading/reading-dialog-host";
import type { ReadingPageData } from "@/components/reading/reading-client";
import type { NoteEdit } from "@/lib/actions/reading-notes";
const actions = vi.hoisted(() => ({ getReadingDialogData: vi.fn(), pauseReading: vi.fn(), resumeReading: vi.fn() }));
const rendered = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/reading", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/reading/reading-dialog-host", () => ({
  ReadingDialogHost: ({ dialog, onClose }: ReadingDialogHostProps) => { rendered(dialog); return h("section", null,
    h("pre", { "data-request": "" }, JSON.stringify(dialog?.request)),
    h("span", { "data-work": "" }, dialog?.data.workId),
    h("button", { onClick: onClose }, "Close rendered"),
    h("button", { onClick: () => dialog?.changed() }, "Reload"),
    h("button", { onClick: () => dialog?.open({ kind: "note", readingId: "r1", back: { kind: "progress", readingId: "r1", draft: {
      segment: "page", fields: { page: "21", percent: "", hours: "", minutes: "", chapter: "" }, readOn: "2026-10-09", minutesRead: "", otherId: "",
    } } }) }, "Continue"),
  ); },
}));
import { ReadingDialogsProvider, useReadingDialogs } from "@/components/reading/reading-dialogs-provider";
import { handleSurfaceEscape, hasOpenSurface } from "@/lib/ui/surface-state";

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const book = (workId: string) => ({ workId, workTitle: workId, homes: [], rows: [{ reading: { id: "r1" }, fingerprint: "fresh" }] }) as unknown as ReadingPageData;
let root: Root; let host: HTMLElement; let dialogs: ReturnType<typeof useReadingDialogs>; let trigger: HTMLButtonElement;
function Consumer() { dialogs = useReadingDialogs(); return null; }
const click = (label: string) => act(() => [...host.querySelectorAll("button")].find((item) => item.textContent === label)!.click());
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
beforeEach(() => {
  vi.clearAllMocks(); document.cookie = "durtal-reading-home=; Max-Age=0; Path=/";
  trigger = document.createElement("button"); trigger.textContent = "Open action"; document.body.append(trigger); trigger.focus();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(h(ReadingDialogsProvider, { children: h(Consumer) })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); trigger.remove(); });
describe("the invocation-only reader dialog facade", () => {
  it("seeds the home sentinel and existing appearance snapshot independently during SSR", () => {
    function Snapshot() {
      const [home] = usePreference<string | null>("durtal-reading-home", null);
      const [appearance] = usePreference("durtal-reader-settings", "default", '"saved typography"');
      return h("p", null, `${home}/${appearance}`);
    }
    expect(renderToString(h(PreferencesProvider, { initial: { "durtal-reading-home": '"none"' }, children: h(Snapshot) }))).toContain("none/saved typography");
  });
  it("guards synchronously and Escape cancels a slow load without late resurrection", async () => {
    const read = deferred<ReadingPageData>(); actions.getReadingDialogData.mockReturnValueOnce(read.promise);
    let opening!: Promise<void>;
    act(() => { opening = dialogs.open({ kind: "start", workId: "one" }); expect(hasOpenSurface()).toBe(true); });
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    act(() => { expect(handleSurfaceEscape(event)).toBe(true); });
    expect(event.defaultPrevented).toBe(true);
    await act(async () => { read.resolve(book("one")); await opening; });
    expect(host.querySelector("[data-work]")).toBeNull(); expect(hasOpenSurface()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("ignores older success and failure after replacement and retains the caller fingerprint", async () => {
    const old = deferred<ReadingPageData>(); const next = deferred<ReadingPageData>();
    actions.getReadingDialogData.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = dialogs.open({ kind: "start", workId: "old" }); second = dialogs.open({ kind: "progress", workId: "new", readingId: "r1", fingerprint: "caller" }); });
    await act(async () => { next.resolve(book("new")); await second; old.reject(new Error("obsolete")); await first; });
    expect(host.querySelector("[data-work]")?.textContent, host.innerHTML).toBe("new");
    expect(rendered.mock.lastCall?.[0]?.row.fingerprint).toBe("caller");
    expect(host.textContent).not.toContain("could not load");
  });

  it("captures an immutable note before awaiting book data", async () => {
    const read = deferred<ReadingPageData>(); actions.getReadingDialogData.mockReturnValueOnce(read.promise);
    const note = { body: "selected passage", commentJson: { text: "original" } } as unknown as NoteEdit;
    let opening!: Promise<void>;
    act(() => { opening = dialogs.open({ kind: "note", workId: "one", note }); });
    note.body = "new selection"; (note.commentJson as { text: string }).text = "changed";
    await act(async () => { read.resolve(book("one")); await opening; });
    expect(host.querySelector("[data-request]")?.textContent).toContain("selected passage");
    expect(host.querySelector("[data-request]")?.textContent).toContain("original");
  });

  it("shows a retryable current failure and resolves the public open promise", async () => {
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    actions.getReadingDialogData.mockRejectedValueOnce(new Error("current failure")).mockResolvedValueOnce(book("one"));
    await act(async () => { await dialogs.open({ kind: "start", workId: "one" }); });
    expect(host.textContent).toContain("could not load"); expect(hasOpenSurface()).toBe(true);
    await act(async () => { click("Retry"); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector("[data-work]")?.textContent).toBe("one"); logging.mockRestore();
  });

  it("fences a same-book reload after a newer request", async () => {
    const stale = deferred<ReadingPageData>();
    actions.getReadingDialogData.mockResolvedValueOnce(book("one")).mockReturnValueOnce(stale.promise).mockResolvedValueOnce(book("one"));
    await act(async () => { await dialogs.open({ kind: "start", workId: "one" }); });
    click("Reload");
    await act(async () => { await dialogs.open({ kind: "past", workId: "one" }); stale.resolve(book("wrong")); await stale.promise; });
    expect(host.querySelector("[data-work]")?.textContent).toBe("one");
    expect(host.querySelector("[data-request]")?.textContent).toContain("past");
  });

  it("reloads fresh data for an internal continuation while preserving the recursive draft", async () => {
    actions.getReadingDialogData.mockResolvedValueOnce(book("one")).mockResolvedValueOnce(book("one"));
    await act(async () => { await dialogs.open({ kind: "progress", workId: "one", readingId: "r1", fingerprint: "caller" }); });
    await act(async () => { click("Continue"); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector("[data-request]")?.textContent).toContain('"back":{"kind":"progress"');
    expect(host.querySelector("[data-request]")?.textContent).toContain('"page":"21"');
    expect(rendered.mock.lastCall?.[0]?.row.fingerprint).toBe("fresh");
  });

  it("does not let a dismissed renderer close or continue a newer dialog", async () => {
    actions.getReadingDialogData.mockResolvedValue(book("one"));
    await act(async () => { await dialogs.open({ kind: "start", workId: "one" }); });
    const old = rendered.mock.lastCall?.[0] as NonNullable<ReadingDialogHostProps["dialog"]>;
    await act(async () => { await dialogs.open({ kind: "past", workId: "one" }); });
    act(() => { old.onClose(); old.open({ kind: "finish", readingId: "r1" }); });
    expect(host.querySelector("[data-request]")?.textContent).toContain("past");
  });
});
