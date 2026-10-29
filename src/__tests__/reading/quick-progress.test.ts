import { describe, expect, it } from "vitest";
import { quickProgressUnit, quickProgressStep, quickProgressSteps } from "@/lib/reading/quick-progress";
import { parseProgressInput } from "@/lib/reading/positions";
import { logPreview, type LogReading } from "@/lib/reading/log-preview";
const reading: LogReading = { editionId: "e", unit: "percent", totalPages: 200, totalMinutes: 100, currentPercent: 40, currentPage: 80, currentMinutes: 40 };
describe("quick progress units", () => {
  it.each(["pages", "percent", "minutes"] as const)("a %s reading follows a touch field, otherwise its unit", (unit) => {
    expect(quickProgressUnit(unit, null)).toBe(unit);
    expect(quickProgressUnit(unit, "page")).toBe("pages");
    expect(quickProgressUnit(unit, "percent")).toBe("percent");
    expect(quickProgressUnit(unit, "time")).toBe("minutes");
  });
  it.each([
    ["pages", 5, "+5", { addPages: 5 }, 85],
    ["percent", 5, "+5%", { percent: 45 }, 45],
    ["minutes", 15, "+15 min", { addMinutes: 15 }, 55],
  ] as const)("the %s button's typed input sends the promised amount", (unit, n, label, send, end) => {
    const step = quickProgressStep(unit, n, reading);
    expect(step.label).toBe(label);
    const parsed = parseProgressInput(step.text, { unit, totalPages: 200, totalMinutes: 100 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw Error(parsed.error);
    const preview = logPreview({ ...reading, unit }, parsed.value)!;
    expect(preview.send).toEqual(send);
    expect(unit === "pages" ? preview.page : unit === "minutes" ? preview.minutes : preview.percent).toBe(end);
  });
  it("caps percent at the end and keeps fractional places", () => {
    expect(quickProgressStep("percent", 5, { ...reading, currentPercent: 97.5 }).value).toBe(100);
    expect(quickProgressStep("percent", 5, { ...reading, currentPercent: 40.5 }).text).toBe("45.5%");
    expect(quickProgressSteps("minutes")).toEqual([15, 30, 60]);
  });
});
