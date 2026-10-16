import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Review of #341: the book's Edit work dialog cut its author names ("Joris-Karl
// Huysmans" at 320) beside the role menu, and the Remove cross was 22px on
// touch. Browser behaviour is measured by hand; this pins the markup.
const form = readFileSync(path.resolve(__dirname, "../../components/books/work-form.tsx"), "utf8");
const row = form.slice(form.indexOf("{values.authors.map((author) => ("), form.indexOf("{showAuthorAdd ?"));

it("wraps an author's name in full, on a line of its own on touch and on a phone", () => {
  expect(row).not.toContain("truncate");
  expect(row).toMatch(/<span className="min-w-0 flex-1 break-words [^"]*max-sm:basis-full pointer-coarse:basis-full/);
  expect(row).toContain("flex flex-wrap items-start");
});

it("sits the role menu and Remove on the name's first line, 44px on touch", () => {
  expect(row).toContain("<CapAligned height={28} coarseHeight={44}>");
  expect(row).toContain("<CapAligned height={22} coarseHeight={44}>");
  expect(row).toMatch(/aria-label="Remove author"/);
  expect(row).toMatch(/className="flex size-\[22px\][^"]*pointer-coarse:size-11"/);
  expect(row).toMatch(/className="block h-7 pointer-coarse:h-11/);
});
