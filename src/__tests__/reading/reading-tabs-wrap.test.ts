import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/reading/stats" }));
import { ReadingTabs } from "@/components/reading/reading-tabs";

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
