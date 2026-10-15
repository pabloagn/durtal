import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Review of #347: a 90-letter one-word author ran about 390px past a phone's
// screen in the book page's byline, and the page scrolled sideways. Browser
// behaviour is measured by hand; this pins the markup.
const page = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/library/[slug]/page.tsx"), "utf8");

it("wraps an author's name in the book page's byline, however long its one word", () => {
  const byline = page.slice(page.indexOf("{primaryAuthors.map((author, i) => ("), page.indexOf("{/* Year and rating."));
  expect(byline).toContain('<span key={author.id} className="min-w-0 text-sm text-fg-secondary [overflow-wrap:anywhere]">');
});

// Review of #355: a wrapped byline started its new line with the comma
// (", Hugo von Hofmannsthal")
it("keeps each comma with the name before it", () => {
  const byline = page.slice(page.indexOf("{primaryAuthors.map((author, i) => ("), page.indexOf("{/* Year and rating."));
  expect(byline).toContain('{i < primaryAuthors.length - 1 && ","}');
  expect(byline).not.toContain("{i > 0 &&");
  expect(byline.indexOf('","}')).toBeGreaterThan(byline.indexOf("author.name"));
});
