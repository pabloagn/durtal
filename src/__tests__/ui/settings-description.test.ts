// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/lib/actions/settings", () => ({ updateAppSettings: vi.fn() }));
import { GeneralSettings } from "@/app/settings/general-settings";
import type { AppSettings } from "@/lib/actions/settings";

const settings: AppSettings = {
  newBookStatus: "tracked", newBookLanguage: "en", newCopyLocationId: null,
  newCopyFormat: "paperback", newCopyCondition: "mint", homeCurrency: "EUR",
  readingDayStartHour: 4, readingWeekStart: 1, readingTimerCheckMinutes: 90,
  readingRhythmDays: null, readingSuggestHideAnathema: false, readingPredictionGate: null,
};

// Audit actual settings controls, including the selects whose guidance was deleted.
it("retains every field name and only references descriptions that exist", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(GeneralSettings, { settings, locations: [] }));
  const controls = [...host.querySelectorAll('[role="combobox"]')];
  expect(controls).toHaveLength(6);
  for (const control of controls) {
    const label = host.querySelector(`label[for="${control.id}"]`);
    expect(label?.textContent?.trim()).toBeTruthy();
    const describedby = control.getAttribute("aria-describedby");
    if (describedby) expect(host.querySelector(`[id="${describedby}"]`)?.textContent?.trim()).toBeTruthy();
  }
  for (const id of ["new-book-status", "new-copy-format", "new-copy-condition"])
    expect(host.querySelector(`[id="${id}"]`)?.getAttribute("aria-describedby")).toBeNull();
  for (const id of ["new-book-language", "new-copy-location", "home-currency"])
    expect(host.querySelector(`[id="${id}"]`)?.getAttribute("aria-describedby")).toBe(`${id}-description`);
});
