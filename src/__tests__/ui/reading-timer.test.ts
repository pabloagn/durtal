// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The reading timer and sessions by hand (SLN-451), with the server actions mocked.

const actions = vi.hoisted(() => ({
  getRunningTimer: vi.fn(async () => null as unknown),
  startTimer: vi.fn(),
  pauseTimer: vi.fn(),
  resumeTimer: vi.fn(),
  discardTimer: vi.fn(),
  stopTimer: vi.fn(),
  undoStopTimer: vi.fn(async () => ({})),
  logProgress: vi.fn(),
  undoProgress: vi.fn(),
  updateReading: vi.fn(),
  getReadingSessions: vi.fn(async () => ({ running: null, sessions: [] as unknown[] })),
  addSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(async () => ({})),
  restoreSession: vi.fn(),
}));
const opened = vi.hoisted(() => ({ list: [] as unknown[] }));
const toasts = vi.hoisted(() => ({ list: [] as { message: string; undo?: () => void }[] }));
vi.mock("@/lib/actions/reading", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({ open: (r: unknown) => opened.list.push(r) }) }));
vi.mock("sonner", () => {
  const push = (message: string, opts?: { action?: { onClick: () => void } }) => toasts.list.push({ message, undo: opts?.action?.onClick });
  return { toast: Object.assign(push, { success: push, error: push, message: push }) };
});

import { TimerProvider, useTimer } from "@/components/reading/timer-provider";
import { TimerAlerts, TimerChip, type TimerChipLayout } from "@/components/reading/timer-chip";
import { LogProgressDialog } from "@/components/reading/dialogs/log-progress-dialog";
import { SessionDialog } from "@/components/reading/dialogs/session-dialog";
import type { ReadingDialogProps } from "@/components/reading/reading-provider";

let coarse = false;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Node's own localStorage global hides the DOM's in this environment
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
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
  opened.list = [];
  Object.values(actions).forEach((fn) => fn.mockClear());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

const FP = "a".repeat(32);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const running = (over: Record<string, unknown> = {}) => ({
  sessionId: "t1",
  readingId: "r1",
  workId: "w1",
  title: "Nadja",
  slug: "nadja",
  author: "André Breton",
  cover: null,
  startedAt: minutesAgo(12),
  pausedAt: null,
  pausedSeconds: 0,
  readOn: "2026-10-05",
  timeZone: "Europe/Amsterdam",
  status: "reading",
  unit: "pages",
  format: "print",
  editionId: "e1",
  totalPages: 480,
  totalMinutes: null,
  currentPage: 180,
  currentPercent: 37.5,
  currentMinutes: null,
  fingerprint: FP,
  ...over,
});

const text = () => host.ownerDocument.body.textContent ?? "";
const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const field = (label: string) => {
  const l = [...host.ownerDocument.querySelectorAll("label")].find((e) => e.textContent?.trim() === label);
  return host.ownerDocument.getElementById(l!.htmlFor) as HTMLInputElement;
};
const submit = async () => {
  await act(async () => {
    host.ownerDocument.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

async function renderChip(layout: TimerChipLayout, timer: unknown) {
  actions.getRunningTimer.mockResolvedValue(timer);
  act(() => root.render(createElement(TimerProvider, null, createElement(TimerChip, { layout }), createElement(TimerAlerts))));
  await flush();
  await flush();
}

describe("the timer chip", () => {
  it.each(["expanded", "rail", "phone"] as const)("names and labels every control in the %s layout", async (layout) => {
    await renderChip(layout, running());
    const chip = host.querySelector(`[data-timer-chip="${layout}"]`)!;
    expect(chip).not.toBeNull();
    const named = chip.querySelector('[aria-label^="Timer for Nadja,"]')!;
    expect(named.getAttribute("aria-label")).toBe("Timer for Nadja, 12 minutes");
    const stop = chip.querySelector("[data-timer-stop]")!;
    expect(stop.getAttribute("aria-label")).toBe("Stop timer");
    expect(stop.getAttribute("data-tooltip")).toBe("Stop timer");
    // The time never jitters and is not a live region
    const time = chip.querySelector(".tabular-nums")!;
    expect(time.textContent).toMatch(/^12:0\d$/);
    expect(chip.querySelector("[aria-live]")).toBeNull();
    if (layout === "expanded") {
      const pause = chip.querySelector("[data-timer-pause]")!;
      expect(pause.getAttribute("aria-label")).toBe("Pause timer");
      expect(pause.getAttribute("data-tooltip")).toBe("Pause timer");
    }
    // Every icon-only button has a name and a tooltip
    for (const b of chip.querySelectorAll("button")) {
      expect(b.getAttribute("aria-label"), b.outerHTML).toBeTruthy();
      expect(b.getAttribute("data-tooltip"), b.outerHTML).toBeTruthy();
    }
  });

  it("shows a paused timer in the secondary colour and says so", async () => {
    await renderChip("expanded", running({ pausedAt: minutesAgo(2), pausedSeconds: 60 }));
    const chip = host.querySelector('[data-timer-chip="expanded"]')!;
    expect(chip.querySelector('[aria-label$="paused"]')).not.toBeNull();
    expect(chip.querySelector(".tabular-nums")!.className).toContain("text-fg-secondary");
    expect(chip.querySelector("[data-timer-pause]")!.getAttribute("aria-label")).toBe("Resume timer");
  });

  it("renders nothing while no timer runs", async () => {
    await renderChip("expanded", null);
    expect(host.querySelector("[data-timer-chip]")).toBeNull();
  });

  it("opens stop mode for the running timer", async () => {
    await renderChip("phone", running());
    act(() => (host.querySelector("[data-timer-stop]") as HTMLButtonElement).click());
    expect(opened.list.at(-1)).toMatchObject({ kind: "progress", readingId: "r1", timer: { sessionId: "t1", pausedSeconds: 0 } });
  });
});

describe("one timer across devices", () => {
  it("asks before starting a second timer, without calling the server", async () => {
    let start: ((t: { readingId: string; workId: string; title: string }) => Promise<void>) | null = null;
    function Starter() {
      start = useTimer().start;
      return null;
    }
    actions.getRunningTimer.mockResolvedValue(running());
    act(() => root.render(createElement(TimerProvider, null, createElement(Starter), createElement(TimerAlerts))));
    await flush();
    await act(async () => start!({ readingId: "r2", workId: "w2", title: "La Curée" }));
    expect(actions.startTimer).not.toHaveBeenCalled();
    expect(text()).toContain("A timer is running for Nadja");
    expect(text()).toContain("Stop it and start this one");
  });

  it("says the timer was stopped on another device when a pause finds it gone, whatever the server's message", async () => {
    await renderChip("expanded", running());
    actions.pauseTimer.mockRejectedValue(new Error("An error occurred in the Server Components render"));
    actions.getRunningTimer.mockResolvedValue(null);
    await act(async () => (host.querySelector("[data-timer-pause]") as HTMLButtonElement).click());
    await flush();
    expect(toasts.list.map((t) => t.message)).toContain("This timer was stopped on another device");
    expect(host.querySelector("[data-timer-chip]")).toBeNull();
  });
});

describe("a forgotten timer", () => {
  it("asks when it was stopped, with the suggested time, and stops there", async () => {
    await renderChip("expanded", running({ startedAt: minutesAgo(6 * 60 + 12) }));
    expect(text()).toContain("Your timer for Nadja has been running for 6 h 12 min. When did you stop?");
    const button = host.ownerDocument.querySelector("[data-timer-stopped-at]") as HTMLButtonElement;
    expect(button.textContent).toMatch(/^Stopped at \d\d:\d\d$/);
    act(() => button.click());
    const request = opened.list.at(-1) as { timer: { endedAt: string; startedAt: string } };
    // The start plus the check time (90 minutes)
    expect(new Date(request.timer.endedAt).getTime() - new Date(request.timer.startedAt).getTime()).toBe(90 * 60_000);
  });

  it("asks nothing again on this device after Still reading", async () => {
    await renderChip("expanded", running({ startedAt: minutesAgo(200) }));
    act(() => (host.ownerDocument.querySelector("[data-timer-still]") as HTMLButtonElement).click());
    expect(host.ownerDocument.querySelector("[data-timer-forgotten]")).toBeNull();
    expect(JSON.parse(localStorage.getItem("durtal-timer-still-reading")!)).toMatchObject({ sessionId: "t1" });
  });
});

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
  currentPage: 180,
  currentPercent: 37.5,
  currentMinutes: null,
  currentChapter: null,
  startPage: null,
  startPercent: null,
  startMinutes: null,
  startedOn: "2026-10-01",
  startedPrecision: "day",
  lastReadAt: null,
};
const row = { reading, fingerprint: FP, ordinal: 1, sessionCount: 2, totalSeconds: 0, edition: null, copy: null, home: null };
const data = {
  workId: "w1",
  workTitle: "Nadja",
  bookRating: null,
  dayStartHour: 4,
  rows: [row],
  editions: [{ id: "e1", title: "Nadja", label: "French · Gallimard · 480 p.", pageCount: 480, language: "fr", translators: [], cover: null, owned: true, copies: [] }],
  homes: [],
  today: "2026-10-05",
  zone: "Europe/Amsterdam",
};
function props(over: Partial<ReadingDialogProps> = {}): ReadingDialogProps {
  return {
    data: data as never,
    row: row as never,
    request: { kind: "progress", readingId: "r1" },
    home: null,
    setHome: () => {},
    onClose: () => {},
    changed: () => {},
    open: (request) => opened.list.push(request),
    ...over,
  };
}

describe("stop mode of Log progress", () => {
  it("says how long he read, asks no date, stops the timer and undoes the stop", async () => {
    actions.stopTimer.mockResolvedValue({
      reading: { fingerprint: "b".repeat(32) },
      session: { durationSeconds: 42 * 60, readOn: "2026-10-05" },
      undo: { sessionId: "t1", restoreEnd: null, repause: false },
      reachedEnd: false,
    });
    const timer = { sessionId: "t1", startedAt: minutesAgo(42), pausedAt: null, pausedSeconds: 0 };
    act(() => root.render(createElement(LogProgressDialog, props({ request: { kind: "progress", readingId: "r1", timer } }))));
    expect(text()).toContain("Stop the timer");
    expect(text()).toContain("You read 42 min. Where are you now?");
    expect(text()).not.toContain("Minutes read");
    type(field("Where are you?"), "212");
    await submit();
    expect(actions.stopTimer).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "t1", page: 212 }));
    expect(actions.logProgress).not.toHaveBeenCalled();
    const undo = toasts.list.find((t) => t.message.startsWith("Saved 42 min"))!.undo!;
    await act(async () => undo());
    expect(actions.undoStopTimer).toHaveBeenCalledWith({ sessionId: "t1", fingerprint: "b".repeat(32), undo: { sessionId: "t1", restoreEnd: null, repause: false } });
  });

  it("stops with no position: the session ends where it started", async () => {
    actions.stopTimer.mockResolvedValue({ reading: { fingerprint: "c".repeat(32) }, session: { durationSeconds: 600, readOn: "2026-10-05" }, undo: {}, reachedEnd: false });
    const timer = { sessionId: "t1", startedAt: minutesAgo(10), pausedAt: null, pausedSeconds: 0, endedAt: minutesAgo(1) };
    act(() => root.render(createElement(LogProgressDialog, props({ request: { kind: "progress", readingId: "r1", timer } }))));
    await submit();
    expect(actions.stopTimer).toHaveBeenCalledWith({ sessionId: "t1", endedAt: new Date(timer.endedAt) });
  });
});

const session = (over: Record<string, unknown>) => ({
  id: "s",
  readingId: "r1",
  editionId: "e1",
  editionTitle: "Nadja",
  format: "print",
  source: "manual",
  readOn: "2026-10-03",
  timeZone: "Europe/Amsterdam",
  startedAt: null,
  endedAt: null,
  durationSeconds: 1800,
  startPage: 150,
  endPage: 180,
  startPercent: 31.25,
  endPercent: 37.5,
  startMinutes: null,
  endMinutes: null,
  endChapter: null,
  note: null,
  pagesTotal: 480,
  pagesRead: 30,
  pausedAt: null,
  pausedSeconds: 0,
  createdAt: new Date("2026-10-03T20:00:00Z"),
  updatedAt: new Date("2026-10-03T20:00:00Z"),
  ...over,
});

describe("Add a session", () => {
  it("shows where it starts, warns when it ends before that, and adds it with Undo", async () => {
    actions.getReadingSessions.mockResolvedValue({ running: null, sessions: [session({ id: "s2", readOn: "2026-10-03", startPage: 150, endPage: 180 }), session({ id: "s1", readOn: "2026-10-01", startPage: 0, endPage: 150 })] });
    actions.addSession.mockResolvedValue({ reading: { fingerprint: "d".repeat(32) }, session: { id: "new" } });
    act(() => root.render(createElement(SessionDialog, props({ request: { kind: "session", readingId: "r1" } }))));
    await flush();
    expect(host.ownerDocument.querySelector("[data-session-from]")!.textContent).toBe("From p. 180, where the session before ended");
    type(field("Where did it end?"), "170");
    expect(text()).toContain("This session ends before the one before it (p. 180); it adds no pages");
    type(field("Where did it end?"), "212");
    expect(host.ownerDocument.querySelector("[data-session-before]")).toBeNull();
    type(field("Hours"), "1");
    type(field("Minutes"), "5");
    await submit();
    expect(actions.addSession).toHaveBeenCalledWith(
      expect.objectContaining({ readingId: "r1", fingerprint: FP, to: { page: 212 }, durationSeconds: 65 * 60, timeZone: expect.any(String), readOn: expect.any(String) }),
    );
    const undo = toasts.list.find((t) => t.message === "Added a session of 1 h 5 min")!.undo!;
    await act(async () => undo());
    expect(actions.deleteSession).toHaveBeenCalledWith({ sessionId: "new", fingerprint: "d".repeat(32) });
  });

  it("starts from where the reading started when no session is before it", async () => {
    actions.getReadingSessions.mockResolvedValue({ running: null, sessions: [] });
    act(() => root.render(createElement(SessionDialog, props({ request: { kind: "session", readingId: "r1" } }))));
    await flush();
    expect(host.ownerDocument.querySelector("[data-session-from]")!.textContent).toBe("From p. 0, where the reading started");
  });

  it("offers Page, Percent and Time keypad fields on a touch screen", async () => {
    coarse = true;
    act(() => root.render(createElement(SessionDialog, props({ request: { kind: "session", readingId: "r1" } }))));
    await flush();
    expect(field("Page").inputMode).toBe("numeric");
    act(() => ([...host.ownerDocument.querySelectorAll('[role="radio"], button')].find((b) => b.textContent === "%") as HTMLElement).click());
    expect(field("Percent").inputMode).toBe("decimal");
    act(() => ([...host.ownerDocument.querySelectorAll('[role="radio"], button')].find((b) => b.textContent === "Time") as HTMLElement).click());
    const hours = [...host.ownerDocument.querySelectorAll("label")].filter((l) => l.textContent === "Hours");
    // Time read and the end position both take hours and minutes, each with a label
    expect(hours.length).toBe(2);
    for (const l of hours) expect((host.ownerDocument.getElementById(l.htmlFor) as HTMLInputElement).inputMode).toBe("numeric");
  });

  it("edits a session and sends its old values back on Undo", async () => {
    const old = session({ id: "s2", startedAt: new Date("2026-10-03T19:30:00Z"), endedAt: new Date("2026-10-03T20:00:00Z") });
    actions.updateSession.mockResolvedValue({ fingerprint: "e".repeat(32) });
    act(() => root.render(createElement(SessionDialog, props({ request: { kind: "session", readingId: "r1", session: old as never } }))));
    await flush();
    expect(host.ownerDocument.querySelector("[data-session-from]")!.textContent).toBe("From p. 150");
    expect(field("Where did it end?").value).toBe("180");
    expect(field("Start time (optional)").value).toBe("21:30");
    type(field("Where did it end?"), "190");
    await submit();
    expect(actions.updateSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s2", fingerprint: FP, end: { page: 190, chapter: null } }));
    // Neither the start nor the length changed, so the end time stays
    expect(actions.updateSession.mock.calls[0][0]).not.toHaveProperty("endedAt");
    const undo = toasts.list.find((t) => t.message === "Saved the session")!.undo!;
    await act(async () => undo());
    expect(actions.updateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: "s2", fingerprint: "e".repeat(32), end: { page: 180, chapter: null }, startedAt: old.startedAt, endedAt: old.endedAt, durationSeconds: 1800 }),
    );
  });
});
