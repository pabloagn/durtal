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
  const select = read("components/ui/select.tsx");
  // By its own name, else by the label that names the field: the Select's
  // own, or a setting row's (settingLabelId), which share one id
  expect(select).toContain("id={`${id}-label`}");
  expect(select).toContain("aria-label={ariaLabel}\n              aria-labelledby={ariaLabel ? undefined : `${id}-label`}");
  expect(read("components/settings/settings-group.tsx")).toContain("settingLabelId = (id: string) => `${id}-label`");
});

it("names the edition form's new contributor fields", () => {
  const form = read("components/books/edition-form.tsx");
  expect(form).toContain('aria-label="Contributor\'s name"');
  expect(form).toContain('ariaLabel="Contributor\'s role"');
});

it("names Edit work's Recommended by list by its label", () => {
  // The label sits above the chosen chips, outside the Select, so it carries the id the list points at
  expect(read("components/books/work-form.tsx")).toContain('<label id={`${id("recommender")}-label`} htmlFor={id("recommender")}');
});
