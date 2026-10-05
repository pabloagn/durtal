// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The note dialog (SLN-453), with the server actions and the editor mocked.

const actions = vi.hoisted(() => ({
  createReadingNote: vi.fn(async (_input: Record<string, unknown>) => ({})),
  updateReadingNote: vi.fn(async (_input: Record<string, unknown>) => ({})),
}));
const toasts = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/lib/actions/reading-notes", () => actions);
vi.mock("@/lib/actions/reading", () => ({ logProgress: vi.fn(), undoProgress: vi.fn(), updateReading: vi.fn(), stopTimer: vi.fn(), undoStopTimer: vi.fn() }));
vi.mock("sonner", () => {
  const push = (message: string) => toasts.list.push(message);
  return { toast: Object.assign(push, { success: push, error: push, message: push }) };
});
// The editor, loaded at once: a button stands for typing a thought in bold
vi.mock("next/dynamic", () => ({
  default: () =>
    function Editor({ onChange, label }: { onChange?: (v: { html: string; json: unknown }) => void; label?: string }) {
      return createElement(
        "button",
        { type: "button", "data-editor": label, onClick: () => onChange?.({ html: "<p><strong>Why</strong></p>", json: { type: "doc" } }) },
        "editor",
      );
    },
}));

// EB Garamond loads through next/font, which needs the Next compiler
vi.mock("next/font/google", () => ({ EB_Garamond: () => ({ variable: "font-prose" }) }));

import { NoteDialog } from "@/components/reading/dialogs/note-dialog";
import { NoteItemView } from "@/components/reading/note-item";
import { LogProgressDialog } from "@/components/reading/dialogs/log-progress-dialog";
import type { ReadingDialogProps } from "@/components/reading/reading-provider";

let coarse = false;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("coarse") ? coarse : false,
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
  coarse = false;
  toasts.list = [];
  opened.length = 0;
  Object.values(actions).forEach((fn) => fn.mockClear());
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
  editionId: "e1",
  format: "print",
  status: "reading",
  unit: "pages",
  totalPages: 480,
  totalMinutes: null,
  currentPage: 212,
  currentPercent: 44.17,
  currentMinutes: null,
  currentChapter: "7",
};
const row = { reading, fingerprint: "a".repeat(32), ordinal: 2, sessionCount: 1, totalSeconds: 0, quoteCount: 0, noteCount: 0, edition: null, copy: null, home: null };
const data = { workId: "w1", workTitle: "Nadja", bookRating: null, dayStartHour: 4, rows: [row], editions: [], homes: [], today: "2026-10-05", zone: "Europe/Amsterdam" };
const opened: unknown[] = [];
const props = (over: Partial<ReadingDialogProps> = {}): ReadingDialogProps => ({
  data: data as never,
  row: row as never,
  request: { kind: "note", noteKind: "quote", readingId: "r1" },
  home: null,
  setHome: () => {},
  onClose: () => {},
  changed: () => {},
  open: (request) => opened.push(request),
  ...over,
});

const doc = () => host.ownerDocument;
const body = () => doc().querySelector("[data-note-body]") as HTMLTextAreaElement;
const write = (el: HTMLTextAreaElement | HTMLInputElement, value: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = async () => {
  await act(async () => {
    doc().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

describe("the note dialog", () => {
  it("starts on the open reading's page and chapter, and sends a quote with its thought", async () => {
    act(() => root.render(createElement(NoteDialog, props())));
    expect((doc().querySelector("[data-note-position]") as HTMLInputElement).value).toBe("212");
    write(body(), "Beauty will be convulsive");
    act(() => (doc().querySelector('[data-editor="Your thought"]') as HTMLButtonElement).click());
    await submit();
    expect(actions.createReadingNote).toHaveBeenCalledWith({
      workId: "w1",
      kind: "quote",
      body: "Beauty will be convulsive",
      readingId: "r1",
      page: 212,
      chapter: "7",
      isFavourite: false,
      commentHtml: "<p><strong>Why</strong></p>",
      commentJson: { type: "doc" },
    });
    expect(toasts.list).toContain("Quote added");
  });

  it("sends a note without a thought, and has no editor for it", async () => {
    act(() => root.render(createElement(NoteDialog, props())));
    act(() => ([...doc().querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Note") as HTMLButtonElement).click());
    expect(doc().querySelector("[data-editor]")).toBeNull();
    write(body(), "Read on the train");
    await submit();
    const sent = actions.createReadingNote.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: "note", body: "Read on the train" });
    expect(sent).not.toHaveProperty("commentHtml");
    expect(sent).not.toHaveProperty("commentJson");
  });

  it("saves with Cmd+Enter from the text area", async () => {
    act(() => root.render(createElement(NoteDialog, props())));
    write(body(), "A passage");
    await act(async () => {
      body().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(actions.createReadingNote).toHaveBeenCalledTimes(1);
  });

  it("joins a word a pasted page broke over two lines", () => {
    act(() => root.render(createElement(NoteDialog, props())));
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: { getData: () => string } };
    paste.clipboardData = { getData: () => "the melan-\ncholy of it" };
    act(() => {
      body().dispatchEvent(paste);
    });
    expect(body().value).toBe("the melancholy of it");
  });

  it("shows the Scan Text hint on a touch screen only, while the text area is empty", () => {
    act(() => root.render(createElement(NoteDialog, props())));
    expect(doc().querySelector("[data-note-scan-hint]")).toBeNull();
    act(() => root.unmount());
    coarse = true;
    root = createRoot(host);
    act(() => root.render(createElement(NoteDialog, props())));
    const hint = doc().querySelector("[data-note-scan-hint]")!;
    expect(hint.textContent).toBe("To copy a printed page, tap and hold here, then Scan Text.");
    expect(body().getAttribute("aria-describedby")).toBe(hint.id);
    expect((doc().querySelector("[data-note-position]") as HTMLInputElement).inputMode).toBe("numeric");
    write(body(), "Typed");
    expect(doc().querySelector("[data-note-scan-hint]")).toBeNull();
  });

  it("takes a percent for a reading counted in percent", () => {
    const pct = { ...row, reading: { ...reading, unit: "percent", currentPage: null, currentPercent: 44 } };
    act(() => root.render(createElement(NoteDialog, props({ data: { ...data, rows: [pct] } as never, row: pct as never }))));
    const field = doc().querySelector("[data-note-position]") as HTMLInputElement;
    expect(field.value).toBe("44");
    expect(field.inputMode).toBe("decimal");
  });

  it("goes back to Log progress, with what was typed there, when it closes", async () => {
    act(() => root.render(createElement(LogProgressDialog, props({ request: { kind: "progress", readingId: "r1" } }))));
    const where = [...doc().querySelectorAll("label")].find((l) => l.textContent === "Where are you?")!;
    write(doc().getElementById(where.htmlFor) as HTMLInputElement, "230");
    act(() => (doc().querySelector("[data-log-quote]") as HTMLButtonElement).click());
    expect(opened.at(-1)).toEqual({
      kind: "note",
      noteKind: "quote",
      readingId: "r1",
      page: 230,
      back: {
        kind: "progress",
        readingId: "r1",
        prefill: "230",
        timer: undefined,
        draft: { segment: "page", fields: { page: "", percent: "", hours: "", minutes: "", chapter: "" }, readOn: expect.any(String), minutesRead: "", otherId: "" },
      },
    });
  });

  it("keeps the page and the minutes typed on a touch screen when Add a quote comes back to Log progress", async () => {
    coarse = true;
    const field = (label: string) => doc().getElementById([...doc().querySelectorAll("label")].find((l) => l.textContent === label)!.htmlFor) as HTMLInputElement;
    act(() => root.render(createElement(LogProgressDialog, props({ request: { kind: "progress", readingId: "r1" } }))));
    write(field("Page"), "230");
    write(field("Minutes read (optional)"), "25");
    act(() => (doc().querySelector("[data-log-quote]") as HTMLButtonElement).click());
    const back = (opened.at(-1) as { back: ReadingDialogProps["request"] }).back;
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(createElement(LogProgressDialog, props({ request: back }))));
    expect([field("Page").value, field("Minutes read (optional)").value]).toEqual(["230", "25"]);
  });

  it("keeps a quote's thought on a page-only edit, and sends it once the editor changes it", async () => {
    const note = { id: "n1", workId: "w1", kind: "quote" as const, body: "Beauty", commentHtml: "<p>Why</p>", page: 12, chapter: null, percent: 2.5, isFavourite: false, readingId: "r1", readingOrdinal: 1 };
    act(() => root.render(createElement(NoteDialog, props({ request: { kind: "note", readingId: "r1", note } }))));
    write(doc().querySelector("[data-note-position]") as HTMLInputElement, "14");
    await submit();
    const sent = actions.updateReadingNote.mock.calls[0][0];
    expect(sent).toMatchObject({ id: "n1", page: 14 });
    expect(["commentHtml", "commentJson"].filter((k) => k in sent)).toEqual([]);
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(createElement(NoteDialog, props({ request: { kind: "note", readingId: "r1", note } }))));
    act(() => (doc().querySelector('[data-editor="Your thought"]') as HTMLButtonElement).click());
    await submit();
    expect(actions.updateReadingNote.mock.calls[1][0]).toMatchObject({ commentHtml: "<p><strong>Why</strong></p>", commentJson: { type: "doc" } });
  });
});

describe("a quote or note", () => {
  it("puts its controls outside any clipping CapAligned box, so a menu opens in full", () => {
    const note = { id: "n1", kind: "quote" as const, body: "Beauty", commentHtml: null };
    act(() => root.render(createElement(NoteItemView, { note, meta: "p. 12", controls: createElement("button", { type: "button", "data-trigger": "" }, "More") })));
    const trigger = doc().querySelector("[data-trigger]")!;
    expect(trigger.closest(".cap-box")).toBeNull();
    // It still sits on the meta line's cap-height center, in CapAlignedControls
    expect(trigger.closest(".align-\\[0\\.5cap\\]")).not.toBeNull();
  });
});
