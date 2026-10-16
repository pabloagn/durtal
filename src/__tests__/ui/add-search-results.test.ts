import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SearchStep } from "@/app/(catalogue)/library/new/steps/search-step";

const base = {
  query: "No such book", setQuery: vi.fn(), results: [], notices: [] as string[],
  isSearching: false, clearResults: vi.fn(), hasSearched: true,
};
function draw(search = base) {
  return renderToStaticMarkup(createElement(SearchStep, { search, onSelect: vi.fn(), onManual: vi.fn(), cancel: null }));
}
it("shows a settled empty search and keeps manual entry available", () => {
  const html = draw();
  expect(html).toContain("No books found");
  expect(html).toContain("Enter details manually");
});
it("does not flash an empty result before the search completes", () => {
  expect(draw({ ...base, hasSearched: false })).not.toContain("No books found");
});
it("shows a source failure without removing manual entry", () => {
  const html = draw({ ...base, notices: ["Open Library could not complete this search."] });
  expect(html).toContain("Open Library could not complete this search.");
  expect(html).toContain("Enter details manually");
});
