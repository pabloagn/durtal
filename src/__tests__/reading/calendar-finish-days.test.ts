// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { dayShade } from "@/lib/reading/charts";
import { CalendarHeatmap } from "@/components/reading/charts/calendar-heatmap";

// SLN-1170 (statistics survey, item 1): a day known only by a finish comes
// back with 0 minutes and 0 pages, and was drawn in the empty shade. "Reading
// days in 2026: 139 days" sat over 365 blank cells for an imported history.

const cells = (days: { day: string; minutes: number; pages: number }[]) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The frame draws its chart once it has a width, which happy-dom never lays out
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 800, height: 200, top: 0, left: 0, right: 800, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(CalendarHeatmap, { year: 2026, weekStart: 1, days })));
  const drawn = [...host.querySelectorAll("rect[data-cal-index]")].map((r) => ({ shade: r.getAttribute("class")!, tip: r.getAttribute("data-tooltip")! }));
  act(() => root.unmount());
  return drawn;
};

describe("the reading-days calendar", () => {
  it("gives a day with reading at least the first shade, and a day without none", () => {
    expect(dayShade(true, 0, 0)).toBe(1);
    expect(dayShade(true, 0, 120)).toBe(1);
    expect(dayShade(true, 120, 120)).toBe(4);
    expect(dayShade(false, 0, 120)).toBe(0);
  });

  it("shades days known only by their finish", () => {
    const drawn = cells([{ day: "2026-01-02", minutes: 0, pages: 0 }, { day: "2026-03-14", minutes: 0, pages: 0 }]);
    expect(drawn).toHaveLength(365);
    const shaded = drawn.filter((c) => c.shade !== "fill-bg-tertiary");
    expect(shaded.map((c) => c.tip)).toEqual(["2 Jan 2026: read", "14 Mar 2026: read"]);
    expect(new Set(shaded.map((c) => c.shade))).toEqual(new Set(["fill-accent-sage/30"]));
  });

  it("shows timed days and finish-only days together in a mixed year", () => {
    const drawn = cells([
      { day: "2026-01-02", minutes: 0, pages: 0 },
      { day: "2026-01-03", minutes: 30, pages: 20 },
      { day: "2026-01-04", minutes: 120, pages: 60 },
    ]);
    const byTip = new Map(drawn.map((c) => [c.tip.split(":")[0], c.shade]));
    expect(byTip.get("2 Jan 2026")).toBe("fill-accent-sage/30");
    expect(byTip.get("3 Jan 2026")).toBe("fill-accent-sage/30");
    expect(byTip.get("4 Jan 2026")).toBe("fill-accent-sage");
    expect(byTip.get("5 Jan 2026")).toBe("fill-bg-tertiary");
  });
});
