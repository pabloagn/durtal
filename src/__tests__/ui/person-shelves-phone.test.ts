import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish 2: a person's books (and films, perfumes, paintings) were one
// full-width card a row on a phone, where every other cover grid keeps two.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../../app/(catalogue)/people/[slug]", file), "utf8");

it("keeps two cards a row on a phone on a person's shelves and their loading screen", () => {
  const page = read("page.tsx");
  expect(page).not.toContain('className="catalogue-grid"');
  expect(page.match(/<PhonePairGrid>/g)).toHaveLength(2);
  const loading = read("loading.tsx");
  expect(loading).not.toContain('className="catalogue-grid"');
  expect(loading).toContain("<PhonePairGrid>");
});
