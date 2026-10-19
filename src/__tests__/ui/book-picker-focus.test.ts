import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-872 (hover-focus survey, item 5): a book picker row showed focus only
// as a faint background (about 1.1:1). It keeps the background and takes the
// house outline, inset so the list's scroller cannot cut it.

const picker = readFileSync(path.resolve(__dirname, "../../components/reading/book-picker.tsx"), "utf8");

it("gives a picker row the house outline, inset", () => {
  expect(picker).toContain("focus-visible:bg-bg-tertiary/50 focus-visible:-outline-offset-2");
  expect(picker).not.toContain("focus-visible:outline-none");
});
