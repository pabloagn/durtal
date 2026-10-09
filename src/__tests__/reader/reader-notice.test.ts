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
      "Page 212 · read on iPhone · 2h ago",
    );
    expect(
      resumeNoticeText(
        { ...position, locator: { ...position.locator, pageLabel: undefined } },
        "epub",
      ),
    ).toBe("40% · Chapter I · read on iPhone · 2h ago");
    expect(resumeNoticeText(position, "pdf")).toBe(
      "About 40% · read on iPhone · 2h ago",
    );
    vi.useRealTimers();
  });
});
