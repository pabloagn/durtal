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

describe("the notice while the bars are hidden (SLN-1143)", () => {
  const show = async (quiet: boolean, children?: string) => {
    const { act, createElement: h } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { ReaderNotice } = await import("@/components/reader/reader-notice");
    const { createReaderBridge } = await import("@/lib/reader/bridge-state");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const bridge = createReaderBridge({ ebookId: "book", fileId: "epub", format: "epub", locator: null,
      percent: null, chapter: null, selection: null });
    const left = document.createElement("span");
    left.textContent = "About 7 h 43 min left";
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(h(ReaderNotice, { bridge, quiet }, children)));
    await act(async () => { bridge.fill("top-bar", left, 0); });
    const notice = host.querySelector<HTMLElement>('[role="status"]')!;
    const result = { faded: notice.className.split(" ").includes("opacity-0"), hidden: notice.hidden, text: notice.textContent };
    await act(async () => root.unmount());
    host.remove();
    return result;
  };
  it("fades the time left with the bars, and keeps it a live region", async () => {
    expect(await show(true)).toEqual({ faded: true, hidden: false, text: "About 7 h 43 min left" });
    expect(await show(false)).toEqual({ faded: false, hidden: false, text: "About 7 h 43 min left" });
  });
  it("keeps an offer or an error up while the bars are hidden", async () => {
    expect(await show(true, "Sync paused.")).toMatchObject({ faded: false, hidden: false });
  });
});
