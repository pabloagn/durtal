// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The book page's reading dialogs (SLN-447), with the server actions mocked.

const actions = vi.hoisted(() => ({
  logProgress: vi.fn(),
  undoProgress: vi.fn(async () => ({})),
  updateReading: vi.fn(),
  finishReading: vi.fn(),
  reopenReading: vi.fn(async () => ({ reading: {}, message: null as string | null })),
  abandonReading: vi.fn(),
  pauseReading: vi.fn(),
  startReading: vi.fn(async (_input: Record<string, unknown>) => ({})),
  getNextInSeries: vi.fn(async () => null),
  findPageCount: vi.fn(async () => null),
}));
const toasts = vi.hoisted(() => ({ list: [] as { message: string; undo?: () => void }[] }));
vi.mock("@/lib/actions/reading", () => actions);
vi.mock("sonner", () => {
  const push = (message: string, opts?: { action?: { onClick: () => void } }) => toasts.list.push({ message, undo: opts?.action?.onClick });
  return { toast: Object.assign(push, { success: push, error: push, message: push }) };
});
vi.mock("@/components/shared/tiptap-editor", () => ({
  TiptapEditor: () => createElement("div", { "data-editor": "" }),
}));

import { LogProgressDialog } from "@/components/reading/dialogs/log-progress-dialog";
import { FinishReadingDialog } from "@/components/reading/dialogs/finish-reading-dialog";
import { AbandonReadingDialog } from "@/components/reading/dialogs/abandon-reading-dialog";
import { StartReadingDialog } from "@/components/reading/dialogs/start-reading-dialog";
import { EditReadingDialog } from "@/components/reading/dialogs/edit-reading-dialog";
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
  Object.values(actions).forEach((fn) => fn.mockClear());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const FP = "a".repeat(32);
const reading = {
  id: "r1",
  workId: "w1",
  editionId: "e1",
  instanceId: null,
  locationId: null,
  format: "print",
  status: "reading",
  unit: "pages",
  totalPages: 480,
  totalMinutes: null,
  startPage: 0,
  startPercent: 0,
  startMinutes: null,
  currentPage: 400,
  currentPercent: 83.33,
  currentMinutes: null,
  currentChapter: null,
  startedOn: "2019-04-14",
  startedPrecision: "day",
  finishedOn: null,
  finishedPrecision: "unknown",
  rating: null,
  reviewHtml: null,
  reviewJson: null,
  abandonReason: null,
  abandonNote: null,
  lastReadAt: null,
};
const row = { reading, fingerprint: FP, ordinal: 1, sessionCount: 2, totalSeconds: 0, edition: null, copy: null, home: null };
const data = {
  workId: "w1",
  workTitle: "Watt",
  bookRating: 4,
  dayStartHour: 4,
  rows: [row],
  editions: [
    { id: "e1", title: "Watt", label: "English · Grove, 1970 · 480 p.", pageCount: 480, language: "en", translators: [], cover: null, owned: true, copies: [] },
    {
      id: "audio",
      title: "Watt (audio)",
      label: "English · Audible · Audiobook",
      pageCount: null,
      language: "en",
      translators: [],
      cover: null,
      owned: true,
      copies: [{ id: "c-audio", format: "audiobook", status: "available", locationId: "k", locationType: "digital", locationName: "Audible", subLocationName: null, line: "Audiobook · Digital" }],
    },
  ],
  homes: [{ id: "ams", name: "Amsterdam" }],
  today: "2026-10-05",
  zone: "Europe/Amsterdam",
};
const opened: unknown[] = [];
function props(over: Partial<ReadingDialogProps> = {}): ReadingDialogProps {
  return {
    data: data as never,
    row: row as never,
    request: { kind: "progress", readingId: "r1" },
    home: "ams",
    setHome: () => {},
    onClose: () => {},
    changed: () => {},
    open: (request) => opened.push(request),
    ...over,
  };
}

const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const field = (label: string) => {
  const l = [...host.ownerDocument.querySelectorAll("label")].find((e) => e.textContent?.trim().startsWith(label));
  return host.ownerDocument.getElementById(l!.htmlFor) as HTMLInputElement;
};
const submit = async () => {
  await act(async () => {
    host.ownerDocument.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};
const text = () => host.ownerDocument.body.textContent ?? "";
/** Picks an option of the custom Select named by its label */
const choose = (label: string, option: string) => {
  act(() => field(label).click());
  const item = [...host.ownerDocument.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim().startsWith(option)) as HTMLElement;
  act(() => item.click());
};

describe("Log progress", () => {
  it("parses live, asks how to move back, and sends the choice", async () => {
    actions.logProgress.mockResolvedValue({ reading: { fingerprint: "b".repeat(32) }, undo: { sessionId: "s1", restoreEnd: { page: 400, percent: 83.33, minutes: null, chapter: null }, repause: false }, reachedEnd: false });
    act(() => root.render(createElement(LogProgressDialog, props())));
    type(field("Where are you?"), "212");
    expect(text()).toContain("Page 212 of 480 · 44.17%");
    expect(text()).toContain("This moves you back from p. 400 to p. 212");
    await submit();
    expect(actions.logProgress).toHaveBeenCalledWith(expect.objectContaining({ readingId: "r1", fingerprint: FP, page: 212, goingBack: "fix_last_log", timeZone: expect.any(String) }));
    // Undo sends the returned payload unchanged, with the new fingerprint
    const undo = toasts.list.find((t) => t.message === "Logged p. 212")!.undo!;
    await act(async () => undo());
    expect(actions.undoProgress).toHaveBeenCalledWith({
      readingId: "r1",
      fingerprint: "b".repeat(32),
      undo: { sessionId: "s1", restoreEnd: { page: 400, percent: 83.33, minutes: null, chapter: null }, repause: false },
    });
  });

  it("sends I went back when chosen, and opens Finish at the end", async () => {
    actions.logProgress.mockResolvedValue({ reading: { fingerprint: "c".repeat(32) }, undo: { sessionId: "s2", restoreEnd: null, repause: true }, reachedEnd: true });
    act(() => root.render(createElement(LogProgressDialog, props())));
    type(field("Where are you?"), "212");
    act(() => (host.ownerDocument.querySelector('input[value="went_back"]') as HTMLInputElement).click());
    await submit();
    expect(actions.logProgress).toHaveBeenCalledWith(expect.objectContaining({ goingBack: "went_back" }));
    expect(opened.at(-1)).toMatchObject({ kind: "finish", readingId: "r1", reachedEnd: true });
  });

  it("logs a sitting in another edition without changing the reading's", async () => {
    actions.logProgress.mockResolvedValue({ reading: { fingerprint: "d".repeat(32) }, undo: { sessionId: "s3", restoreEnd: null, repause: false }, reachedEnd: false });
    act(() => root.render(createElement(LogProgressDialog, props({ row: { ...row, reading: { ...reading, currentPage: 100, currentPercent: 20.83 } } as never }))));
    act(() => ([...host.ownerDocument.querySelectorAll("button")].find((b) => b.textContent === "Read in another edition or format") as HTMLButtonElement).click());
    choose("Read in another edition or format", "English · Audible");
    type(field("Where are you?"), "33%");
    expect(text()).toContain("33% · the reading moves to p. 158 of 480");
    await submit();
    const sent = actions.logProgress.mock.calls[0][0];
    expect(sent).toMatchObject({ percent: 33, editionId: "audio", format: "audio" });
    expect(actions.updateReading).not.toHaveBeenCalled();
  });

  it("offers keypad fields on a touch screen", async () => {
    coarse = true;
    act(() => root.render(createElement(LogProgressDialog, props({ row: { ...row, reading: { ...reading, currentPage: 10, currentPercent: 2.08 } } as never }))));
    expect(field("Page").inputMode).toBe("numeric");
    const segments = [...host.ownerDocument.querySelectorAll('[role="radio"], [role="tab"], button')].filter((b) => ["Page", "%", "Time"].includes(b.textContent ?? ""));
    act(() => (segments.find((b) => b.textContent === "%") as HTMLElement).click());
    expect(field("Percent").inputMode).toBe("decimal");
    type(field("Percent"), "44,5");
    expect(text()).toContain("44.5%");
    act(() => (segments.find((b) => b.textContent === "Time") as HTMLElement).click());
    expect(field("Hours").inputMode).toBe("numeric");
    expect(field("Minutes").inputMode).toBe("numeric");
  });
});

describe("Finish and Abandon", () => {
  it("Undo of Finish passes the payload back and shows the server's message", async () => {
    const undo = { toStatus: "paused", position: { page: 400, percent: 83.33, minutes: null, chapter: null }, closingSessionId: "s9", restoreBookRating: { before: 4, after: 4.5 } };
    actions.finishReading.mockResolvedValue({ reading: { fingerprint: "e".repeat(32) }, undo });
    actions.reopenReading.mockResolvedValue({ reading: {}, message: "The book's rating was changed since; it was kept" });
    act(() => root.render(createElement(FinishReadingDialog, props({ request: { kind: "finish", readingId: "r1" } }))));
    await submit();
    expect(actions.finishReading).toHaveBeenCalledWith(expect.objectContaining({ readingId: "r1", fingerprint: FP, setBookRating: true, timeZone: expect.any(String) }));
    await act(async () => toasts.list.find((t) => t.message === "Finished Watt")!.undo!());
    expect(actions.reopenReading).toHaveBeenCalledWith({ readingId: "r1", fingerprint: "e".repeat(32), ...undo });
    expect(toasts.list.map((t) => t.message)).toContain("The book's rating was changed since; it was kept");
  });

  it("refuses a finish before the start", async () => {
    act(() => root.render(createElement(FinishReadingDialog, props({ request: { kind: "finish", readingId: "r1", finishedOn: "2019-03-01" } }))));
    expect(text()).toContain("The finish date is before the start date");
  });

  it("Undo of Abandon passes the payload back", async () => {
    const undo = { toStatus: "reading", position: { page: 400, percent: 83.33, minutes: null, chapter: null }, closingSessionId: null, restoreBookRating: null };
    actions.abandonReading.mockResolvedValue({ reading: { fingerprint: "f".repeat(32) }, undo });
    act(() => root.render(createElement(AbandonReadingDialog, props({ request: { kind: "abandon", readingId: "r1" } }))));
    await submit();
    expect(actions.abandonReading).toHaveBeenCalledWith(expect.objectContaining({ page: 400, reason: "lost_interest" }));
    await act(async () => toasts.list.find((t) => t.message === "Abandoned Watt")!.undo!());
    expect(actions.reopenReading).toHaveBeenCalledWith({ readingId: "r1", fingerprint: "f".repeat(32), ...undo });
  });
});

describe("Start reading", () => {
  it("sends exactly one start position and the home", async () => {
    const printOnly = { ...data, editions: [data.editions[0]] };
    act(() => root.render(createElement(StartReadingDialog, props({ data: printOnly as never, row: null, request: { kind: "start" } }))));
    type(field("Already at"), "150");
    expect(text()).toContain("Starting at p. 150 of 480 · 31.25%");
    await submit();
    const sent = actions.startReading.mock.calls[0][0];
    expect(sent).toMatchObject({ workId: "w1", editionId: "e1", startPage: 150, locationId: "ams", timeZone: expect.any(String) });
    expect("startPercent" in sent || "startMinutes" in sent).toBe(false);
  });

  it("takes the digital copy at hand when the home has no physical one, and prefills its audio length", async () => {
    const audioRow = { ...row, reading: { ...reading, id: "r0", status: "finished", editionId: "audio", totalMinutes: 580 } };
    act(() =>
      root.render(createElement(StartReadingDialog, props({ data: { ...data, rows: [audioRow] } as never, row: null, request: { kind: "start" } }))),
    );
    expect(field("Audio length").value).toBe("9:40");
    type(field("Already at"), "2:30");
    await submit();
    expect(actions.startReading.mock.calls[0][0]).toMatchObject({ editionId: "audio", instanceId: "c-audio", format: "audio", startMinutes: 150, totalMinutes: 580, locationId: "ams" });
  });

  it("homes the reading at the copy's physical place, else at I'm at", async () => {
    const shelfCopy = { id: "c-shelf", format: "paperback", status: "available", locationId: "mex", locationType: "physical", locationName: "Mexico City", subLocationName: null, line: "Paperback · On your shelf in Mexico City" };
    const withShelf = { ...data, editions: [{ ...data.editions[0], copies: [shelfCopy] }] };
    act(() => root.render(createElement(StartReadingDialog, props({ data: withShelf as never, row: null, request: { kind: "start" }, home: "ams" }))));
    expect(text()).toContain("Reading in Mexico City");
    await submit();
    expect(actions.startReading.mock.calls[0][0]).toMatchObject({ instanceId: "c-shelf", locationId: "mex" });
  });
});

describe("Edit reading", () => {
  it("edits start, current position and chapter in one save with a live unit-bearing preview", async () => {
    const book = { ...row, reading: { ...reading, totalPages: 600 } };
    act(() =>
      root.render(
        createElement(
          EditReadingDialog,
          props({
            row: book as never,
            request: { kind: "edit", readingId: "r1" },
          }),
        ),
      ),
    );
    type(field("Starting position"), "150");
    type(field("Current position"), "350");
    type(field("Current chapter"), "  Part II  ");
    expect(text()).toContain("Starting at p. 150 of 600 · 25%");
    expect(text()).toContain("Corrects the last log");
    await submit();
    expect(actions.updateReading).toHaveBeenCalledWith(
      expect.objectContaining({
        startPage: 150,
        currentPosition: { page: 350 },
        currentChapter: "Part II",
      }),
    );
    expect(actions.updateReading).toHaveBeenCalledTimes(1);
    expect(actions.logProgress).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not submit unchanged current fields for a chapter-only edit (touched=%s)", async (touched) => {
    const effective = { ...row, reading: { ...reading, totalPages: 600, currentPage: 240, currentPercent: 40, currentChapter: "I" } };
    act(() => root.render(createElement(EditReadingDialog, props({ row: effective as never, request: { kind: "edit", readingId: "r1" } }))));
    if (touched) type(field("Current position"), "240");
    type(field("Current chapter"), "II");
    await submit();
    expect(actions.updateReading).toHaveBeenCalledWith({ readingId: "r1", fingerprint: FP, currentChapter: "II" });
  });

  it("shows the start-derived current place and allows smaller totals before any log", async () => {
    const empty = { ...row, sessionCount: 0, reading: { ...reading, totalPages: 600, startPage: 400, startPercent: 66.67, currentPage: 400, currentPercent: 66.67 } };
    act(() => root.render(createElement(EditReadingDialog, props({ row: empty as never, request: { kind: "edit", readingId: "r1" } }))));
    type(field("Pages to read"), "300");
    type(field("Starting position"), "100");
    expect(field("Current position").disabled).toBe(true);
    expect(field("Current position").value).toBe("100");
    expect(text()).toContain("Starting at p. 100 of 300 · 33.33%");
    expect(text()).not.toContain("You are on p. 400");
    await submit();
    expect(actions.updateReading).toHaveBeenCalledWith({ readingId: "r1", fingerprint: FP, totalPages: 300, startPage: 100 });
  });

  it("combines an audio edition switch, new duration and start using the displayed duration", async () => {
    const audio = { ...row, sessionCount: 0, reading: { ...reading, format: "audio", unit: "minutes", totalPages: null, totalMinutes: 60, startPage: null, startPercent: 50, startMinutes: 30, currentPage: null, currentPercent: 50, currentMinutes: 30 } };
    act(() => root.render(createElement(EditReadingDialog, props({ row: audio as never, request: { kind: "edit", readingId: "r1" } }))));
    choose("Edition", "English · Audible");
    choose("Start unit", "Time");
    type(field("Audio length"), "2:00");
    type(field("Starting position"), "1:30");
    expect(text()).toContain("Starting at 1:30 of 2:00 · 75%");
    await submit();
    expect(actions.updateReading).toHaveBeenCalledWith({ readingId: "r1", fingerprint: FP, editionId: "audio", totalMinutes: 120, startMinutes: 90 });
  });

  it("clears a chapter explicitly", async () => {
    const named = { ...row, reading: { ...reading, currentChapter: "II" } };
    act(() => root.render(createElement(EditReadingDialog, props({ row: named as never, request: { kind: "edit", readingId: "r1" } }))));
    type(field("Current chapter"), "");
    await submit();
    expect(actions.updateReading).toHaveBeenCalledWith(expect.objectContaining({ currentChapter: null }));
  });

  it("keeps percent and audio minutes as exactly one unit each", async () => {
    act(() =>
      root.render(
        createElement(
          EditReadingDialog,
          props({ request: { kind: "edit", readingId: "r1" } }),
        ),
      ),
    );
    choose("Start unit", "Percent");
    type(field("Starting position"), "25");
    choose("Current unit", "Time");
    type(field("Current position"), "2:30");
    await submit();
    expect(actions.updateReading).toHaveBeenCalledWith(
      expect.objectContaining({
        startPercent: 25,
        currentPosition: { minutes: 150 },
      }),
    );
    expect(actions.updateReading.mock.calls[0][0]).not.toHaveProperty(
      "startPage",
    );
    expect(actions.updateReading.mock.calls[0][0]).not.toHaveProperty(
      "startMinutes",
    );
  });

  it("keeps current-position controls disabled without a completed log while allowing a start and chapter edit", async () => {
    const empty = {
      ...row,
      sessionCount: 0,
      reading: { ...reading, currentPage: 0, currentPercent: 0 },
    };
    act(() =>
      root.render(
        createElement(
          EditReadingDialog,
          props({
            row: empty as never,
            request: { kind: "edit", readingId: "r1" },
          }),
        ),
      ),
    );
    expect(field("Current position").disabled).toBe(true);
    expect(text()).toContain(
      "Log progress once before editing the current position",
    );
    type(field("Starting position"), "100");
    type(field("Current chapter"), "Opening");
    await submit();
    expect(actions.updateReading).toHaveBeenCalledWith(
      expect.objectContaining({ startPage: 100, currentChapter: "Opening" }),
    );
    expect(actions.updateReading.mock.calls[0][0]).not.toHaveProperty(
      "currentPosition",
    );
  });

  it("validates against changed totals and does not save invalid or absent positions", async () => {
    act(() =>
      root.render(
        createElement(
          EditReadingDialog,
          props({ request: { kind: "edit", readingId: "r1" } }),
        ),
      ),
    );
    type(field("Starting position"), "500");
    expect(text()).toContain("Page 500 is past the last page, 480");
    await submit();
    expect(actions.updateReading).not.toHaveBeenCalled();
    type(field("Starting position"), "150");
    type(field("Current position"), "200");
    type(field("Pages to read"), "300");
    expect(text()).toContain("Starting at p. 150 of 300 · 50%");
    await submit();
    expect(actions.updateReading).toHaveBeenCalledWith(
      expect.objectContaining({
        startPage: 150,
        totalPages: 300,
        currentPosition: { page: 200 },
      }),
    );
    actions.updateReading.mockClear();
    type(field("Starting position"), "");
    await submit();
    expect(actions.updateReading).not.toHaveBeenCalled();
  });

  it("does not convert an edition-only switch into a current-position correction", async () => {
    const empty = { ...row, sessionCount: 0 };
    act(() =>
      root.render(
        createElement(
          EditReadingDialog,
          props({
            row: empty as never,
            request: { kind: "edit", readingId: "r1" },
          }),
        ),
      ),
    );
    choose("Edition", "English · Audible");
    await submit();
    expect(actions.updateReading).toHaveBeenCalledWith(
      expect.objectContaining({ editionId: "audio" }),
    );
    expect(actions.updateReading.mock.calls[0][0]).not.toHaveProperty(
      "currentPosition",
    );
    expect(actions.updateReading.mock.calls[0][0]).not.toHaveProperty(
      "startPercent",
    );
  });

  it("keeps the edit open and reports a rejected atomic save without a success toast", async () => {
    const close = vi.fn();
    actions.updateReading.mockRejectedValueOnce(
      new Error("This reading changed elsewhere; reload before saving"),
    );
    act(() =>
      root.render(
        createElement(
          EditReadingDialog,
          props({ onClose: close, request: { kind: "edit", readingId: "r1" } }),
        ),
      ),
    );
    type(field("Current position"), "250");
    await submit();
    expect(close).not.toHaveBeenCalled();
    expect(toasts.list.some((t) => t.message === "Reading saved")).toBe(false);
  });


  it("refuses a page count that is not a whole number instead of clearing it", async () => {
    actions.updateReading.mockResolvedValue({ fingerprint: "g".repeat(32) });
    act(() => root.render(createElement(EditReadingDialog, props({ request: { kind: "edit", readingId: "r1" } }))));
    for (const bad of ["abc", "12.5", "0"]) {
      type(field("Pages to read"), bad);
      expect(text()).toContain("Enter the number of pages as a whole number above 0");
      await submit();
      expect(actions.updateReading).not.toHaveBeenCalled();
    }
    type(field("Pages to read"), "500");
    expect(text()).not.toContain("Enter the number of pages");
    await submit();
    expect(actions.updateReading).toHaveBeenCalledWith(expect.objectContaining({ readingId: "r1", fingerprint: FP, totalPages: 500 }));
  });

  it("refuses an audio length it cannot read", async () => {
    const audio = { ...row, reading: { ...reading, format: "audio", unit: "minutes", totalMinutes: 580 } };
    act(() => root.render(createElement(EditReadingDialog, props({ row: audio as never, request: { kind: "edit", readingId: "r1" } }))));
    type(field("Audio length"), "soon");
    expect(text()).toContain("Enter a length such as 9:40");
    await submit();
    expect(actions.updateReading).not.toHaveBeenCalled();
  });
});
