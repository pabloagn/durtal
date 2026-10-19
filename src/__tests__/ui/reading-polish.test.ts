// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { OnThisDay } from "@/components/reading/on-this-day";
import { beforeWritten } from "@/components/reading/dialogs/past-read-dialog";
import { startTitle } from "@/components/reading/dialogs/start-reading-dialog";
import { formatDateline } from "@/lib/utils/dateline";
import { readingControlLabel, type ReadingSummary } from "@/lib/reading/labels";

/* Reading polish (SLN-932) */

const html = (el: ReturnType<typeof createElement>) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(el);
  return host;
};

describe("reading polish (SLN-932)", () => {
  it("names a date picker by its label without an id from the caller", () => {
    const host = html(createElement(DatePicker, { label: "Date", value: "2026-10-16" }));
    const label = host.querySelector("label")!;
    expect(label.htmlFor).toBeTruthy();
    expect(host.querySelector(`[id="${label.htmlFor}"]`)?.tagName).toBe("BUTTON");
  });

  it("says the share before the first page, and groups page numbers", () => {
    const base: ReadingSummary = {
      id: "r", status: "reading", unit: "pages", currentPage: 0, totalPages: 240, currentPercent: 0,
      currentMinutes: null, totalMinutes: null, finishedOn: null, finishedPrecision: "unknown",
    } as ReadingSummary;
    expect(readingControlLabel([base])).toBe("Reading · 0%");
    expect(readingControlLabel([{ ...base, currentPage: 1234, totalPages: 1500, currentPercent: 82.27 }])).toBe("Reading · p. 1,234 of 1,500 · 82%");
    expect(readingControlLabel([{ ...base, status: "abandoned", currentPage: 1200 }])).toBe("Abandoned at p. 1,200");
  });

  it("titles the start dialog as the menu named it", () => {
    expect(startTitle("unread")).toBe("Start reading");
    expect(startTitle("read")).toBe("Start a re-read");
    expect(startTitle("abandoned")).toBe("Start again");
  });

  it("words a rating on On this day", () => {
    const hit = { kind: "finished", day: "2026-10-16", year: 2019, workId: "w", slug: "against-nature", title: "Against Nature", rating: 1.5 };
    const text = html(createElement(OnThisDay, { hits: [hit] as never, serverToday: "2026-10-16", dayStartHour: 4, reviewYears: [] })).textContent;
    expect(text).toBe("On this day in 2019 you finished Against Nature and rated it 1.5 stars.");
    const one = html(createElement(OnThisDay, { hits: [{ ...hit, rating: 1 }] as never, serverToday: "2026-10-16", dayStartHour: 4, reviewYears: [] })).textContent;
    expect(one).toContain("rated it 1 star.");
  });

  it("flags a past read dated before the book was written, without refusing it", () => {
    expect(beforeWritten(1947, { date: "1850-01-01", precision: "year" }, { date: null, precision: "unknown" })).toBe(
      "This is before the book was written, in 1947. You can still log it.",
    );
    expect(beforeWritten(1947, { date: "1947-01-01", precision: "year" })).toBeNull();
    expect(beforeWritten(null, { date: "1850-01-01", precision: "year" })).toBeNull();
    expect(beforeWritten(-8, { date: "0001-01-01", precision: "year" })).toBeNull();
  });

  it("lets a select wrap a value that must show whole", () => {
    const options = [{ value: "e", label: "French · Edition not identified · 240 p." }];
    const wrapped = html(createElement(Select, { label: "Edition", wrap: true, value: "e", options })).querySelector('[role="combobox"]')!;
    expect(wrapped.className).toContain("min-h-8");
    expect(wrapped.querySelector("span")!.className).not.toContain("truncate");
    // The chevron stays on the first line, centred on its 20px
    expect(wrapped.className).toContain("items-start");
    expect(wrapped.className).not.toContain("items-center");
    expect(wrapped.querySelector("svg")!.getAttribute("class")).toContain("mt-[3px]");
    const plain = html(createElement(Select, { label: "Edition", value: "e", options })).querySelector('[role="combobox"]')!;
    expect(plain.className).toContain("h-8");
    expect(plain.querySelector("span")!.className).toContain("truncate");
    expect(plain.className).toContain("items-center");
    expect(plain.querySelector("svg")!.getAttribute("class")).not.toContain("mt-[3px]");
  });

  it("writes the dateline in the zone it is given", () => {
    // 02:30 UTC on Friday is still Thursday evening in Los Angeles
    const at = new Date("2026-10-16T02:30:00Z");
    expect(formatDateline(at, "America/Los_Angeles")).toBe("Thursday 15 October 2026");
    expect(formatDateline(at, "Europe/Amsterdam")).toBe("Friday 16 October 2026");
  });
});
