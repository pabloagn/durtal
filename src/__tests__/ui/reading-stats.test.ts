// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The stats page (SLN-456) in the browser, with its data mocked: the charts'
// keyboard and table, the header's goal button, and the Stats tab.

const nav = vi.hoisted(() => ({ pathname: "/reading/stats" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/notifications/toast", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (load: () => Promise<React.ComponentType<object>>) => {
      const Lazy = React.lazy(() => load().then((c) => ({ default: c })));
      return (props: object) => React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
    },
  };
});
vi.mock("@/lib/actions/reading-goals", () => ({
  getGoalProgress: vi.fn(async () => []),
  getGoalDialogData: vi.fn(async () => ({ year: 2025, goals: [], workTypes: [], history: [] })),
  setReadingGoal: vi.fn(async () => ({})),
  removeReadingGoal: vi.fn(async () => ({})),
}));
vi.mock("@/lib/actions/settings", () => ({ getAppSettings: vi.fn(async () => ({ readingDayStartHour: 4, readingWeekStart: 1, readingRhythmDays: null })) }));
vi.mock("@/lib/reading/stats", () => {
  const book = (title: string, value: number) => ({ workId: `w-${title}`, title, slug: null, value });
  const none = { count: 0, avg: null };
  return {
    statsYears: async () => [2025, 2024],
    finishedYears: async () => [{ year: 2025, books: 7 }],
    yearNumbers: vi.fn(async (_year: number | null) => ({ books: 7, pages: 2_310, hours: 31, readingDays: 4, avgRating: 4.1, rereads: 1, abandoned: 1, avgLength: 330, audioWithoutPages: 0, undated: 0 })),
    overTheYear: async () => ({
      bars: Array.from({ length: 12 }, (_, i) => ({ key: i + 1, books: [3, 1, 0, 2, 0, 0, 0, 0, 0, 0, 1, 0][i], pages: [900, 300, 0, 700, 0, 0, 0, 0, 0, 0, 410, 0][i] })),
      unknown: null,
    }),
    readingDays: async () => ({
      calendar: [
        { day: "2025-01-01", minutes: 30, pages: 20 },
        { day: "2025-01-08", minutes: 90, pages: 60 },
        { day: "2025-03-14", minutes: 45, pages: 0 },
        { day: "2025-12-31", minutes: 20, pages: 10 },
      ],
      weekdays: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, minutes: weekday * 10, sessions: 1 })),
      partsOfDay: (["night", "morning", "afternoon", "evening"] as const).map((part, i) => ({ part, minutes: i * 20, sessions: i })),
      peak: { weekday: 7, part: "evening" },
      withoutStart: 0,
    }),
    ratings: async () => ({ distribution: Array.from({ length: 10 }, (_, i) => ({ rating: (i + 1) / 2, count: i === 7 ? 4 : i === 8 ? 2 : 0 })), reread: [], higherOnReread: 0 }),
    lengthAndPace: async () => ({
      lengths: [
        { label: "Under 150", count: 1 },
        { label: "150 to 299", count: 3 },
        { label: "300 to 499", count: 2 },
        { label: "500 to 799", count: 1 },
        { label: "800 or more", count: 0 },
      ],
      longest: book("Long", 640),
      shortest: book("Short", 120),
      fastest: null,
      slowest: null,
      pace: [],
    }),
    languages: async () => ({ languages: [], known: 0, translated: 0, topSource: null, translators: [] }),
    authorStats: async () => ({ byBooks: [], byPages: [], newAuthors: [], countries: [], genders: [] }),
    eras: async () => ({ centuries: [], decades: [], movements: [], workTypes: [], categories: [] }),
    whereAndHow: async () => ({ formats: [], homes: [], ownCopy: 0, noCopy: 0 }),
    shelfTime: async () => ({ counted: 0, avgDays: null, longest: [], readBeforeOwned: 0, withoutAcquisitionDate: 0, withoutPreciseStart: 0 }),
    unreadPile: async () => ({ books: 0, pages: 0, withoutPages: 0, pagesPerYear: 0, years: null, atHand: [] }),
    recommenderStats: async () => [],
    abandoned: async () => ({ count: 0, reasons: [], medianPercent: null }),
    insightInputs: async () => ({ short: none, long: none, translated: none, original: none, rereads: none, firstReads: none, ownCopy: none, noCopy: none, finished: 7, started: 8 }),
  };
});

import ReadingStatsPage from "@/app/(catalogue)/reading/(tabs)/stats/page";
import { yearNumbers } from "@/lib/reading/stats";
import { readingDay } from "@/lib/reading/dates";
import { appTimeZone } from "@/lib/utils/date";
import { ReadingTabs } from "@/components/reading/reading-tabs";

// The dialog's modules take 1 to 4 s to load the first time, more under a full run's load, and that time
// counted inside the test's 5 s. Loaded here, the click still opens it through React.lazy, from the module cache
beforeAll(async () => {
  await import("@/components/reading/goal-dialog");
}, 30_000);

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as never;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute("open", "");
  };
  // The charts measure their width: 640px wide here
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 200, width: 640, height: 200, toJSON: () => ({}) } as DOMRect;
  };
  Element.prototype.scrollIntoView ??= () => {};
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  nav.pathname = "/reading/stats";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const render = async (element: ReactElement) => {
  await act(async () => root.render(element));
  await flush();
};
const page = async () => render((await ReadingStatsPage({ searchParams: Promise.resolve({ year: "2025" }) })) as ReactElement);
const chart = (label: string) => host.querySelector(`[data-chart="${label}"]`) as HTMLElement;
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
const TABBABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

describe("the stats page's reads", () => {
  // The sections start beside the list of years (SLN-885)
  it("reads the year the address names once, and reads again only for a year with no reading", async () => {
    const asked = async (year?: string) => {
      vi.mocked(yearNumbers).mockClear();
      await ReadingStatsPage({ searchParams: Promise.resolve(year ? { year } : {}) });
      return vi.mocked(yearNumbers).mock.calls.map(([y]) => y);
    };
    expect(await asked("2024")).toEqual([2024]);
    expect(await asked("all")).toEqual([null]);
    // The reading day's year, as the page counts it (the mocked day start hour is 4)
    const current = Number(readingDay(new Date(), appTimeZone(), 4).slice(0, 4));
    expect(await asked()).toEqual([current]);
    expect(await asked("1999")).toEqual([1999, current]);
  });
});

describe("the stats charts", () => {
  it("give each chart one tab stop, with an SVG image that holds nothing focusable", async () => {
    await page();
    const charts = [...host.querySelectorAll("figure[data-chart]")];
    expect(charts.map((c) => c.getAttribute("data-chart"))).toEqual([
      "Books finished by month",
      "Pages read by month",
      "Reading days in 2025",
      "Reading by weekday",
      "Reading by time of day",
      "Books by rating",
      "Books by length in pages",
    ]);
    for (const figure of charts) {
      const frame = figure.querySelector("[data-chart-frame]")!;
      expect([frame.getAttribute("tabindex"), frame.getAttribute("role")]).toEqual(["0", "group"]);
      expect(frame.getAttribute("aria-label")).toBe(figure.getAttribute("data-chart"));
      expect(document.getElementById(frame.getAttribute("aria-describedby")!)).toBe(figure.querySelector("[data-chart-caption]"));
      // The chart, then its table toggle: nothing else to tab to
      expect([...figure.querySelectorAll(TABBABLE)]).toEqual([frame, figure.querySelector("[data-chart-table-toggle]")]);
      const svg = figure.querySelector("svg")!;
      expect(svg.getAttribute("role")).toBe("img");
      expect(svg.getAttribute("aria-label")).toBeTruthy();
      expect(svg.querySelectorAll(TABBABLE)).toHaveLength(0);
    }
  });

  it("moves through the bars with the arrow keys, Home and End, in the caption and the live region", async () => {
    await page();
    const figure = chart("Books finished by month");
    const frame = figure.querySelector("[data-chart-frame]")!;
    const caption = () => figure.querySelector("[data-chart-caption]")!.textContent;
    const live = () => figure.querySelector("[data-chart-live]")!.textContent;
    // Every bar's count with its noun in the right form, not "... Dec 0 books"
    expect(caption()).toMatch(/^Books finished by month: January 2025: 3 books; February 2025: 1 book; March 2025: 0 books;/);
    await key(frame, "ArrowRight");
    expect([caption(), live()]).toEqual(["January 2025: 3 books", "January 2025: 3 books"]);
    await key(frame, "ArrowRight");
    expect(caption()).toBe("February 2025: 1 book");
    await key(frame, "End");
    expect([caption(), live()]).toEqual(["December 2025: 0 books", "December 2025: 0 books"]);
    await key(frame, "Home");
    expect(caption()).toBe("January 2025: 3 books");
    // The focused bar has an outline
    expect(figure.querySelectorAll('svg [stroke="var(--color-accent-primary)"]')).toHaveLength(1);
  });

  it("moves through the calendar a day with Left and Right and a week with Up and Down", async () => {
    await page();
    const figure = chart("Reading days in 2025");
    const frame = figure.querySelector("[data-chart-frame]")!;
    const caption = () => figure.querySelector("[data-chart-caption]")!.textContent;
    await key(frame, "ArrowRight");
    expect(caption()).toBe("1 Jan 2025: 30 min, 20 pages");
    await key(frame, "ArrowDown");
    expect(caption()).toBe("8 Jan 2025: 1 h 30 min, 60 pages");
    await key(frame, "ArrowRight");
    expect(caption()).toBe("9 Jan 2025: no reading");
    await key(frame, "ArrowUp");
    expect(caption()).toBe("2 Jan 2025: no reading");
    await key(frame, "End");
    expect(caption()).toBe("31 Dec 2025: 20 min, 10 pages");
  });

  it("shows the same numbers as a table as the chart's image says", async () => {
    await page();
    for (const label of ["Books finished by month", "Books by rating", "Reading by weekday"]) {
      const figure = chart(label);
      const toggle = figure.querySelector("[data-chart-table-toggle]") as HTMLButtonElement;
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      act(() => toggle.click());
      expect([toggle.getAttribute("aria-expanded"), toggle.textContent]).toEqual(["true", "Hide table"]);
      const rows = [...figure.querySelectorAll("[data-chart-table] tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
      // "Books finished by month: January 2025: 3 books; February 2025: 1 book; ..."
      const said = figure.querySelector("svg")!.getAttribute("aria-label")!.replace(`${label}: `, "").split("; ");
      expect(said).toHaveLength(rows.length);
      // Counts of books read the same; the weekday's minutes read as "1 h" in words
      if (label !== "Reading by weekday") said.forEach((text, i) => expect(text).toMatch(new RegExp(`: ${rows[i][1]} books?$`)));
    }
  });

  it("opens the goal dialog from the header's Set a reading goal", async () => {
    await page();
    const button = host.querySelector("[data-goal-open]") as HTMLButtonElement;
    expect(button.textContent).toBe("Set a reading goal");
    act(() => button.click());
    for (let i = 0; i < 100 && !document.querySelector("[data-goal-dialog]"); i++) await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(document.querySelector("dialog[open]")!.textContent).toContain("Set a reading goal");
    // The Year in review: the year's own review, since 2025 has finished books
    expect(host.querySelector("[data-stats-review]")!.getAttribute("href")).toBe("/reading/year/2025");
  });
});

describe("the Stats tab", () => {
  it("is current on the stats page and on the Year in review", async () => {
    for (const path of ["/reading/stats", "/reading/year", "/reading/year/2025"]) {
      nav.pathname = path;
      await render(createElement(ReadingTabs));
      expect([...host.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent)).toEqual(["Stats"]);
    }
    nav.pathname = "/reading/journal";
    await render(createElement(ReadingTabs));
    expect([...host.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent)).toEqual(["Journal"]);
  });
});
