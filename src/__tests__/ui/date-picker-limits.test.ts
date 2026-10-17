// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DatePicker } from "@/components/ui/date-picker";

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
