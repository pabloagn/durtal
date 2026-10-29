import type { ReadingUnit } from "./constants";
import type { LogReading } from "./log-preview";

/** Touch follows the selected field; a typed entry follows the reading/edition unit. */
export function quickProgressUnit(unit: ReadingUnit, segment: "page" | "percent" | "time" | null): ReadingUnit {
  return segment === null ? unit : segment === "page" ? "pages" : segment === "time" ? "minutes" : "percent";
}
export function quickProgressSteps(unit: ReadingUnit): number[] {
  return unit === "minutes" ? [15, 30, 60] : [5, 10, 25];
}
/** The displayed increment and typed/absolute values always describe the same amount. */
export function quickProgressStep(unit: ReadingUnit, step: number, current: Pick<LogReading, "currentPage" | "currentPercent" | "currentMinutes">) {
  const value = unit === "percent" ? Math.min(100, Math.round(((current.currentPercent ?? 0) + step) * 100) / 100)
    : (unit === "minutes" ? current.currentMinutes ?? 0 : current.currentPage ?? 0) + step;
  return { value, label: `+${step}${unit === "percent" ? "%" : unit === "minutes" ? " min" : ""}`,
    // The parser accepts relative pages/minutes; percent is an explicit absolute position.
    text: unit === "percent" ? `${value}%` : `+${step}` };
}
