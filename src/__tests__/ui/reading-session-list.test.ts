// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const fixtures = vi.hoisted(() => ({ sessions: [] as unknown[] }));
vi.mock("@/lib/actions/reading", () => ({
  getReadingSessions: vi.fn(async () => ({ running: null, sessions: fixtures.sessions })),
  deleteSession: vi.fn(), restoreSession: vi.fn(),
}));
vi.mock("@/components/reading/reading-provider", () => ({
  useReading: () => ({ data: { today: "2026-10-17" }, open: vi.fn(), changed: vi.fn() }),
}));
vi.mock("@/components/reading/timer-provider", () => ({ useOptionalTimer: () => null }));

import { SessionList } from "@/components/reading/session-list";

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("shows duration without an invented position, while keeping a real position suffix", async () => {
  const base = {
    readingId: "r", editionId: "e", editionTitle: "Book", format: "print", source: "manual",
    readOn: "2026-10-16", timeZone: "Europe/Amsterdam", startedAt: null, endedAt: null,
    startPage: null, startPercent: null, startMinutes: null,
    endPage: null, endPercent: null, endMinutes: null, endChapter: null,
    pagesTotal: 240, pagesRead: null, note: null, pausedAt: null, pausedSeconds: 0,
    createdAt: new Date("2026-10-16T12:00:00Z"), updatedAt: new Date("2026-10-16T12:00:00Z"),
  };
  fixtures.sessions = [
    { ...base, id: "duration", durationSeconds: 11520 },
    { ...base, id: "position", endPage: 80, endPercent: 33.33, durationSeconds: null },
  ];
  const row = { reading: { id: "r", editionId: "e", format: "print", unit: "pages" }, fingerprint: "a".repeat(32), sessionCount: 2, totalSeconds: 11520 };
  await act(async () => root.render(createElement(SessionList, { row: row as never, current: true })));
  await act(async () => (host.querySelector("[data-sessions-toggle]") as HTMLButtonElement).click());
  const duration = host.querySelector('[data-session="duration"]')!;
  expect(duration.textContent).toContain("3 h 12 min");
  expect(duration.textContent).not.toContain("to the start");
  expect(duration.textContent).not.toContain("p.");
  expect(host.querySelector('[data-session="position"]')!.textContent).toContain("to p. 80");
});
