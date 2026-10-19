// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DatePicker } from "@/components/ui/date-picker";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";
import type { AppSettings } from "@/lib/actions/settings";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("allows both boundary dates while disabling days before min and after max", () => {
  act(() => root.render(createElement(DatePicker, { value: "2026-10-16", min: "2026-10-15", max: "2026-10-17" })));
  act(() => host.querySelector("button")!.click());
  const day = (number: string) => [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === number)!;
  expect(day("14").disabled).toBe(true);
  expect(day("15").disabled).toBe(false);
  expect(day("16").disabled).toBe(false);
  expect(day("17").disabled).toBe(false);
  expect(day("18").disabled).toBe(true);
});

it("keeps future dates selectable when no maximum is supplied", () => {
  act(() => root.render(createElement(DatePicker, { value: "2026-10-16" })));
  act(() => host.querySelector("button")!.click());
  const nextDay = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "17")!;
  expect(nextDay.disabled).toBe(false);
});

// The button writes the chosen day as the app writes dates; weeks start as the reading settings say (SLN-1097)
it("shows the chosen day as 18 Oct 2026, and an empty one as Choose a date", () => {
  act(() => root.render(createElement(DatePicker, { value: "2026-10-18" })));
  expect(host.querySelector("button")!.textContent).toBe("18 Oct 2026");
  expect(host.querySelector("button")!.getAttribute("data-draft-value")).toBe("2026-10-18");
  act(() => root.render(createElement(DatePicker, { value: "" })));
  expect(host.querySelector("button")!.textContent).toBe("Choose a date");
});

it("starts the calendar's weeks on Monday, or on Sunday when the reading week does", () => {
  const firstWeekday = (weekStart: 1 | 7) => {
    act(() => root.render(createElement(AppSettingsProvider, { settings: { readingWeekStart: weekStart } as AppSettings, children: createElement(DatePicker, { value: "2026-10-18" }) })));
    act(() => host.querySelector("button")!.click());
    const day = host.querySelector("thead th, [role='columnheader']")?.getAttribute("aria-label");
    act(() => host.querySelector("button")!.click());
    return day;
  };
  expect(firstWeekday(1)).toBe("Monday");
  expect(firstWeekday(7)).toBe("Sunday");
});
