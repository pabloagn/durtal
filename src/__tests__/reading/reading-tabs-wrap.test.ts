import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/reading/stats" }));
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { StatsYears } from "@/components/reading/stats-years";

// SLN-800: on a phone the tab row wrapped nothing and scrolled sideways, cutting
// "Stats" to "Stat" and "Now" to "low". The row now wraps whole tabs.
describe("Reading tabs on a narrow screen", () => {
  const html = renderToStaticMarkup(createElement(ReadingTabs));
  const row = html.match(/<ul[^>]*data-reading-tabs[^>]*>/)?.[0] ?? "";

  it("wraps onto further lines instead of scrolling sideways", () => {
    expect(row).toMatch(/\bflex-wrap\b/);
    expect(row).not.toMatch(/overflow-x-auto|whitespace-nowrap/);
  });

  it("keeps every label whole on one line", () => {
    const labels = [...html.matchAll(/<a [^>]*class="([^"]*)"[^>]*>([^<]*)<\/a>/g)];
    expect(labels.map((m) => m[2])).toEqual(["Now", "Up next", "Journal", "Notes", "Stats", "Suggestions", "Import"]);
    for (const [, cls] of labels) expect(cls).toMatch(/\bwhitespace-nowrap\b/);
  });
});

// The Stats years stay one row that scrolls (a long record holds dozens of
// years), in smaller, quieter chips than the tabs above them
describe("Stats years", () => {
  const years = [{ label: "All time", href: "/reading/stats?year=all", current: false },
    ...Array.from({ length: 32 }, (_, i) => ({ label: String(2026 - i), href: `/reading/stats?year=${2026 - i}`, current: i === 0 }))];
  const html = renderToStaticMarkup(createElement(StatsYears, { years }));
  const tabs = renderToStaticMarkup(createElement(ReadingTabs));

  it("is one row that scrolls sideways on touch, and wraps with a mouse", () => {
    const row = html.match(/<ul[^>]*data-stats-years[^>]*>/)?.[0] ?? "";
    const classes = row.match(/class="([^"]*)"/)![1].split(" ");
    expect(classes).toContain("overflow-x-auto");
    expect(classes).not.toContain("flex-wrap");
    // A mouse has no swipe, and the row shows no scrollbar (SLN-821)
    expect(classes).toEqual(expect.arrayContaining(["pointer-fine:flex-wrap", "pointer-fine:overflow-x-visible"]));
    // Its boxes start on the page's edge, as the tabs' do: the chosen year's
    // fill never sits past it
    expect(classes.some((c) => c.startsWith("-ml-"))).toBe(false);
    expect(html.match(/<a /g)).toHaveLength(33);
  });

  it("uses smaller type than the tabs, and a fill of its own for the chosen year", () => {
    const chip = html.match(/<a [^>]*aria-current="page"[^>]*class="([^"]*)"|<a [^>]*class="([^"]*)"[^>]*aria-current="page"/);
    const chosen = chip?.[1] ?? chip?.[2] ?? "";
    expect(chosen).toMatch(/\btext-xs\b/);
    // Clearly chosen, but not the tabs' selection fill (SLN-821)
    expect(chosen).toMatch(/\bbg-bg-tertiary\b/);
    expect(chosen).not.toMatch(/\bbg-selection-bg/);
    // A year hovered never looks chosen: the fill is the chosen year's alone (SLN-1195)
    const other = html.match(/<a (?![^>]*aria-current)[^>]*class="([^"]*)"/)?.[1] ?? "";
    expect(other).toMatch(/\bborder\b/);
    expect(other).not.toMatch(/\bbg-bg-tertiary\b/);
    expect(tabs).toMatch(/\btext-sm\b/);
  });
});
