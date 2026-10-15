import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish, 15 Oct: a book with no cover showed the title's letter on
// the library's cards, a book icon on the Reading pages and a collection's
// items, an empty box in the book page's reading card and "No cover" in its
// edition card. Every blank cover now shows the letter (`CoverLetter`).
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

it("keeps the letter to the type scale as the box grows, centered on its cap height", () => {
  const letter = read("components/books/cover-letter.tsx");
  expect(letter).toContain("font-serif text-xs leading-none text-fg-muted/30 [text-box:trim-both_cap_alphabetic] @[56px]/cover:text-lg @[120px]/cover:text-3xl");
  expect(letter).toContain('data-decorative=""');
  expect(letter).toContain('"@container/cover flex items-center justify-center"');
});

it("draws every blank cover with it", () => {
  for (const file of [
    "components/books/book-card.tsx",
    "components/books/edition-cover.tsx",
    "components/reading/reading-tiles.tsx",
    "components/reading/reading-section.tsx",
    "app/(catalogue)/collections/[id]/page.tsx",
  ]) {
    const source = read(file);
    expect(source, file).toContain("<CoverLetter title={");
    expect(source, file).toContain("COVER_BLANK");
  }
  expect(read("components/books/edition-cover.tsx")).not.toContain("No cover\n");
});

it("names the title on every reading cover but the timer chip's", () => {
  const files = [
    "components/reading/reading-tiles.tsx",
    "components/reading/queue-list.tsx",
    "components/reading/hub-cards.tsx",
    "components/reading/suggestions/hidden-list.tsx",
    "components/reading/suggestions/pick-one.tsx",
    "components/reading/suggestions/suggestion-list.tsx",
    "components/reading/import/import-client.tsx",
    "app/(catalogue)/reading/(tabs)/page.tsx",
    "app/(catalogue)/reading/year/[year]/page.tsx",
    "app/(catalogue)/reading/(tabs)/suggestions/page.tsx",
  ];
  for (const file of files) {
    for (const call of read(file).match(/<Cover s3Key=[^\n]*/g) ?? []) expect(call, file).toContain(" title={");
  }
  expect(read("components/reading/timer-chip.tsx")).not.toMatch(/<Cover [^\n]*title=/);
});
