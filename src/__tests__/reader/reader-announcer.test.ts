// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ReaderAnnouncer,
  readerLocationAnnouncement,
} from "@/components/reader/reader-announcer";
import type { EngineEvents } from "@/lib/reader/engine";
import type { SpeechPhase } from "@/lib/reader/speech/player";
let root: Root, host: HTMLElement;
const location = (
  page: string,
  reason: "turn" | "jump" = "turn",
): EngineEvents["relocate"] => ({
  reason,
  tocItem: null,
  visibleChars: 100,
  linear: true,
  paginated: true,
  chapter: "Chapter two",
  atEnd: false,
  locator: {
    v: 1,
    fileHash: "a".repeat(64),
    href: "chapter.xhtml",
    sectionIndex: 1,
    progression: 0.2,
    totalProgression: 0.3,
    pageLabel: page,
  },
});
const render = (
  place: EngineEvents["relocate"] | null,
  speechPhase: SpeechPhase = "stopped",
) =>
  act(() => root.render(h(ReaderAnnouncer, { location: place, speechPhase })));
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const status = () => host.querySelector('[role="status"]')!;
describe("reader polite announcements", () => {
  it("announces a jump immediately with chapter and page in one atomic region", () => {
    render(location("xii", "jump"));
    expect(status().textContent).toBe("Chapter two, page xii");
    expect(host.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(status().getAttribute("aria-atomic")).toBe("true");
  });
  it("coalesces repeated rapid turns into the latest page after quiet time", () => {
    for (let i = 1; i <= 10; i++) {
      render(location(String(i)));
      act(() => vi.advanceTimersByTime(100));
    }
    expect(status().textContent).toBe("");
    act(() => vi.advanceTimersByTime(599));
    expect(status().textContent).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(status().textContent).toBe("Page 10");
    render({ ...location("10") });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a jump supersedes a queued turn and percent fallback is bounded", () => {
    render(location("1"));
    render(location("9", "jump"));
    act(() => vi.advanceTimersByTime(700));
    expect(status().textContent).toBe("Chapter two, page 9");
    const place = location("", "jump");
    place.locator.totalProgression = 2;
    expect(readerLocationAnnouncement(place)).toBe("Chapter two, 100%");
  });
  it("reports speech transitions once without chatter on each sentence", () => {
    render(null);
    expect(status().textContent).toBe("");
    render(null, "playing");
    expect(status().textContent).toBe("Reading aloud");
    const mutation = vi.spyOn(status(), "textContent", "set");
    render(null, "preparing");
    render(null, "starting");
    render(null, "playing");
    expect(mutation).not.toHaveBeenCalled();
    render(null, "paused");
    expect(status().textContent).toBe("Paused");
    render(null, "playing");
    expect(status().textContent).toBe("Reading aloud");
    render(null);
    expect(status().textContent).toBe("Stopped");
    mutation.mockRestore();
  });
  it("speech transitions clear pending turns, and unmount clears remaining timers", () => {
    render(location("1"));
    render(location("1"), "playing");
    act(() => vi.advanceTimersByTime(700));
    expect(status().textContent).toBe("Reading aloud");
    render(location("2"), "playing");
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    root = createRoot(host);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("does not announce speech or layout movement as a chapter jump", () => {
  expect(
    readerLocationAnnouncement({ ...location("12", "jump"), origin: "speech" }),
  ).toBe("");
  expect(
    readerLocationAnnouncement({ ...location("12", "jump"), origin: "layout" }),
  ).toBe("");
});
