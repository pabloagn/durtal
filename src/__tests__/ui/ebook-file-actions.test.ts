import { readFileSync } from "fs";
import path from "path";
import { expect, it } from "vitest";

// The e-book page's Download, Open first and Replace file are text commands
// (SLN-693). On touch each grows to a 44px press area around its line, so
// when the narrow Actions cell wraps them, its row gap must leave room for
// both grown boxes: else the command below covers the lower half of the one
// above (a 28px press area at 390).
const read = (file: string) => readFileSync(path.join(process.cwd(), "src", file), "utf8");

it("keeps wrapped file commands' press areas apart on touch", () => {
  const source = read("components/ebooks/ebook-files-table.tsx");
  const cell = source.slice(source.indexOf('if (column === "actions")'));
  expect(cell).toContain("text-command");
  expect(cell).toMatch(/<div className="flex flex-wrap gap-2 pointer-coarse:gap-y-7">/);
});
