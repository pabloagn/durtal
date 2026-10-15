import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish, 15 Oct: every whole book in a collection read "The book, no
// edition chosen" over "Book · Reading". One line now says what is collected
// and where the reading stands.
const page = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/collections/[id]/page.tsx"), "utf8");

it("gives a whole book's row one line: Any edition, then its reading", () => {
  expect(page).not.toContain('facts: "The book, no edition chosen"');
  expect(page).toMatch(/facts: null,\s*note: \["Any edition", state\(w\.id\)\]\.filter\(Boolean\)\.join\(" · "\),/);
});
