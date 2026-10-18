import { describe, expect, it } from "vitest";
import { defaultFinishDate, readingDateError, readingDateLimit } from "@/lib/reading/dates";

describe("the finish date default", () => {
  it("retains a valid Amsterdam start while the browser is still on the previous day", () => {
    const now = new Date("2026-10-16T00:30:00Z");
    const date = defaultFinishDate("2026-10-15", "2026-10-16");
    expect(date).toBe("2026-10-16");
    expect(readingDateError(date, "day", readingDateLimit("America/Los_Angeles", "2026-10-16", now))).toBeNull();
  });
  it.each([null, "2026-10-14", "2026-10-16"])("uses local today for an earlier or absent start: %s", (start) => {
    expect(defaultFinishDate("2026-10-16", start)).toBe("2026-10-16");
  });
  it("does not turn an old invalid future start into an acceptable finish", () => {
    const date = defaultFinishDate("2026-10-15", "2031-05-01");
    expect(readingDateError(date, "day", readingDateLimit("America/Los_Angeles", "2031-05-01", new Date("2026-10-16T00:30:00Z")))).not.toBeNull();
  });
});
