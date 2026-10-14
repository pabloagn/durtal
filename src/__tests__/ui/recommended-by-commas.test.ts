import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// "Recommended by" lists its names as text commands. On touch each name is a
// flex box, which dropped the space after a leading comma ("Club,Ana") and,
// when a name wrapped, started the next line with the comma. The comma now
// ends its own name and keeps its space. Browser layout is measured by hand;
// this pins the markup.
it("ends each recommender's name with its comma and keeps the space", () => {
  const source = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/library/[slug]/page.tsx"), "utf8");
  const block = source.slice(source.indexOf("{/* Recommended by */}"), source.indexOf("{/* end content-on-backdrop */}"));
  expect(block).not.toMatch(/\{i > 0 && \(/);
  const link = block.indexOf("href={`/recommenders/${wr.recommender.id}`}");
  const comma = block.search(/\{i < work\.workRecommenders\.length - 1 && \(\s*<span className="whitespace-pre /);
  expect(link).toBeGreaterThan(-1);
  expect(comma).toBeGreaterThan(link);
});
