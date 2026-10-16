import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-816: the empty states that said nothing, used internal words or
// offered no next step (third loading and error states survey, item 6)
const read = (file: string) => readFileSync(path.resolve(__dirname, "../../app/(catalogue)", file), "utf8");

it("Taxonomy with no family says what a family is and how to add one", () => {
  expect(read("taxonomy/page.tsx")).toMatch(/title="No taxonomy families"\s*description="A family groups the terms you tag works with, such as genres or themes\. Add one with New family\."/);
});

it("a taxonomy item with nothing tagged names what can be tagged, not entities", () => {
  const page = read("taxonomy/[familySlug]/[itemSlug]/page.tsx");
  expect(page).not.toContain("No associated entities");
  expect(page).toContain('title="Nothing tagged yet"');
  expect(page).toContain("No book, film, perfume or painting is tagged ${item.name} yet. Tag one from its page.");
});
