import { afterEach, describe, it, expect } from "vitest";
import { addDays, calendarDate, todayLocal } from "@/lib/utils/date";

describe("calendarDate", () => {
  it("gives the Amsterdam date at 00:30 local time, not the UTC date", () => {
    // 00:30 CEST on 4 Oct 2026 is 22:30 UTC on 3 Oct.
    const now = new Date("2026-10-03T22:30:00Z");
    expect(now.toISOString().slice(0, 10)).toBe("2026-10-03");
    expect(calendarDate(now, "Europe/Amsterdam")).toBe("2026-10-04");
  });

  it("handles winter time", () => {
    // 00:30 CET on 15 Jan 2026 is 23:30 UTC on 14 Jan.
    expect(calendarDate(new Date("2026-01-14T23:30:00Z"), "Europe/Amsterdam")).toBe(
      "2026-01-15",
    );
  });
});

describe("todayLocal", () => {
  const original = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = original;
  });

  it("uses APP_TIMEZONE on the server", () => {
    process.env.APP_TIMEZONE = "America/New_York";
    expect(todayLocal(new Date("2026-10-04T02:00:00Z"))).toBe("2026-10-03");
  });

  it("defaults to Europe/Amsterdam on the server", () => {
    delete process.env.APP_TIMEZONE;
    expect(todayLocal(new Date("2026-10-03T22:30:00Z"))).toBe("2026-10-04");
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-10-28", 7)).toBe("2026-11-04");
    expect(addDays("2026-12-30", 7)).toBe("2027-01-06");
  });
});
