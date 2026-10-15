import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// The accessible-names survey (findings/a11y-names-survey-2026-10-15.md):
// five controls a screen reader announced with no name, or only their
// placeholder. Each lives in one shared component. A book's blank cover
// link is named by its title since #408 (cover-link-name.test.ts).
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

it("names a place card's picture link", () => {
  expect(read("components/venues/venue-card.tsx")).toContain('<Link href={href} aria-label={name} className="block">');
});

it("names the search palette's field", () => {
  expect(read("components/layout/command-palette.tsx")).toContain('aria-label="Search the catalogue, or type a command"');
});

it("names every list search, not only by its placeholder", () => {
  expect(read("components/shared/entity-filters.tsx")).toContain('aria-label={searchPlaceholder.replace(/(\\.\\.\\.|…)$/, "")}');
  expect(read("app/(catalogue)/library/new/steps/search-step.tsx")).toContain('aria-label="Search by title, author, or ISBN"');
  expect(read("app/(catalogue)/taxonomy/[familySlug]/taxonomy-family-shell.tsx")).toContain('aria-label="Filter items"');
});

it("names a Select's open list as its field", () => {
  expect(read("components/ui/select.tsx")).toMatch(/role="listbox"\s*\/\/[^\n]*\n\s*aria-label=\{ariaLabel \?\? label\}/);
});
