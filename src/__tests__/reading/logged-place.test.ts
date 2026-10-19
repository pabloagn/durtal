import { describe, expect, it, vi } from "vitest";
import { createReaderBridge } from "@/lib/reader/bridge-state";
import { loggedPlaceAhead, loggedPlaceLabel, loggedPlaceWhere, type LoggedReading } from "@/lib/reading/logged-place";

const reading = (place: Partial<LoggedReading> = {}): LoggedReading => ({
  id: "0e6f1b4a-1c7e-4c55-9d2b-3b1c2d4e5f60", fingerprint: "a".repeat(32), status: "reading",
  unit: "pages", percent: 50, page: 120, totalPages: 240, chapter: null, ...place,
});

describe("the logged place ahead of the reader (SLN-931)", () => {
  it("shows the jump only when the logged place is more than a page ahead", () => {
    // p. 120 of 240: a page is 0.4167%
    expect(loggedPlaceAhead(reading(), 3.5)).toBe(true);
    expect(loggedPlaceAhead(reading(), 49.7)).toBe(false);
    expect(loggedPlaceAhead(reading(), 50)).toBe(false);
    expect(loggedPlaceAhead(reading(), 80)).toBe(false);
  });
  it("counts 1% as a page without the edition's page count", () => {
    expect(loggedPlaceAhead(reading({ unit: "percent", page: null, totalPages: null }), 48.5)).toBe(true);
    expect(loggedPlaceAhead(reading({ unit: "percent", page: null, totalPages: null }), 49.5)).toBe(false);
  });
  it("shows nothing without a logged place, or before the reader has one", () => {
    expect(loggedPlaceAhead(reading({ percent: null }), 3.5)).toBe(false);
    expect(loggedPlaceAhead(reading(), null)).toBe(false);
    expect(loggedPlaceAhead(null, 3.5)).toBe(false);
  });
  it("names the logged page, else its share of the book", () => {
    expect(loggedPlaceLabel(reading())).toBe("Jump to p. 120");
    // An e-book reading counts in percent, and keeps the page it was logged at
    expect(loggedPlaceLabel(reading({ unit: "percent" }))).toBe("Jump to p. 120");
    expect(loggedPlaceLabel(reading({ unit: "percent", page: null, totalPages: null, percent: 62.5 }))).toBe("Jump to 62%");
    // The phone's short form
    expect(loggedPlaceWhere(reading())).toBe("p. 120");
    expect(loggedPlaceWhere(reading({ page: null, percent: 62.5 }))).toBe("62%");
  });
});

describe("a plug-in's jump through the reader bridge (SLN-931)", () => {
  const bridge = () => createReaderBridge({ ebookId: "book", fileId: "epub", format: "epub", locator: null,
    percent: null, chapter: null, selection: null });
  it("goes through the jump the reader registered, and reports whether it moved", async () => {
    const reader = bridge();
    expect(await reader.jump(50)).toBe(false);
    const go = vi.fn(async () => true);
    const unregister = reader.registerJump(go);
    expect(await reader.jump(50)).toBe(true);
    expect(go).toHaveBeenCalledWith(50);
    unregister();
    expect(await reader.jump(50)).toBe(false);
  });
  it("keeps a newer registration when an older one unregisters", async () => {
    const reader = bridge();
    const old = reader.registerJump(async () => false);
    reader.registerJump(async () => true);
    old();
    expect(await reader.jump(10)).toBe(true);
  });
});
