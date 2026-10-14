// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { resumeNoticeText } from "@/components/reader/reader-notice";
import { place } from "./fixtures/places";
describe("resume notice text", () => {
  it("formats page labels, chapter percentages, cross-file approximations and relative time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    const position = place({
      deviceLabel: "iPhone · Safari",
      locator: { ...place().locator, pageLabel: "212" },
    });
    expect(resumeNoticeText(position, "epub")).toBe(
      "p. 212 · iPhone · Safari · 2h ago",
    );
    expect(
      resumeNoticeText(
        { ...position, locator: { ...position.locator, pageLabel: undefined } },
        "epub",
      ),
    ).toBe("40% · Chapter I · iPhone · Safari · 2h ago");
    expect(resumeNoticeText(position, "pdf")).toBe(
      "About 40% · iPhone · Safari · 2h ago",
    );
    vi.useRealTimers();
  });
  it("says how far the other place is from yours, in pages when both have numbers (SLN-686)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    const other = place({ deviceLabel: "Linux · Firefox", locator: { ...place().locator, pageLabel: "7" } });
    const here = { ...other.locator, pageLabel: "14", totalProgression: 0.6 };
    expect(resumeNoticeText(other, "epub", here)).toBe("p. 7 · 7 pages behind you · Linux · Firefox · 2h ago");
    expect(resumeNoticeText(other, "epub", { ...here, pageLabel: "6" })).toBe("p. 7 · 1 page ahead of you · Linux · Firefox · 2h ago");
    expect(resumeNoticeText(other, "epub", { ...here, pageLabel: "vii" })).toBe("p. 7 · 20% behind you · Linux · Firefox · 2h ago");
    expect(resumeNoticeText(other, "epub", { ...here, pageLabel: "7" })).toBe("p. 7 · Linux · Firefox · 2h ago");
    expect(resumeNoticeText(other, "pdf", here)).toBe("About 40% · Linux · Firefox · 2h ago");
    vi.useRealTimers();
  });
});
