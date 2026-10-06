import { describe, expect, it } from "vitest";
import { openingHoursRows } from "@/lib/catalogue/opening-hours";

// A venue's opening hours as day rows, never raw JSON (SLN-292)

const p = (day: number, open: [number, number], close?: [number, number]) => ({
  open: { day, hour: open[0], minute: open[1] },
  ...(close ? { close: { day, hour: close[0], minute: close[1] } } : {}),
});

describe("openingHoursRows", () => {
  it("reads Google's day lines, inside regularOpeningHours or not", () => {
    const weekdayDescriptions = [
      "Monday: 10:00 AM – 7:00 PM",
      "Tuesday: 10:00 AM – 7:00 PM",
      "Sunday: Closed",
    ];
    const rows = [
      { day: "Monday", hours: "10:00 AM – 7:00 PM" },
      { day: "Tuesday", hours: "10:00 AM – 7:00 PM" },
      { day: "Sunday", hours: "Closed" },
    ];
    expect(openingHoursRows({ weekdayDescriptions })).toEqual(rows);
    expect(openingHoursRows({ regularOpeningHours: { weekdayDescriptions, periods: [] } })).toEqual(rows);
  });

  it("builds the week from periods, Monday first, with closed days and split days", () => {
    const rows = openingHoursRows({
      periods: [p(1, [9, 0], [13, 0]), p(1, [14, 30], [18, 0]), p(6, [10, 0], [16, 0]), p(3, [9, 0], [17, 5])],
    });
    expect(rows).toEqual([
      { day: "Monday", hours: "9:00–13:00, 14:30–18:00" },
      { day: "Tuesday", hours: "Closed" },
      { day: "Wednesday", hours: "9:00–17:05" },
      { day: "Thursday", hours: "Closed" },
      { day: "Friday", hours: "Closed" },
      { day: "Saturday", hours: "10:00–16:00" },
      { day: "Sunday", hours: "Closed" },
    ]);
  });

  it("says always open for one period that never closes", () => {
    const rows = openingHoursRows({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }] });
    expect(rows).toHaveLength(7);
    expect(new Set(rows!.map((r) => r.hours))).toEqual(new Set(["Open 24 hours"]));
  });

  it("shows nothing for hours it cannot read", () => {
    for (const value of [null, undefined, "9 to 5", [], {}, { periods: [] }, { periods: [{ open: { day: 9 } }] }, { weekdayDescriptions: [3] }])
      expect(openingHoursRows(value), JSON.stringify(value)).toBeNull();
  });
});
