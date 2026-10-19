import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { coverLetter } from "@/components/books/cover-letter";

// Design polish, 15 Oct: a book with no cover showed the title's letter on
// the library's cards, a book icon on the Reading pages and a collection's
// items, an empty box in the book page's reading card and "No cover" in its
// edition card. Every blank cover now shows the letter (`CoverLetter`).
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

it("keeps the letter to the type scale as the box grows, centered on its cap height", () => {
  const letter = read("components/books/cover-letter.tsx");
  expect(letter).toContain('className="cover-letter"');
  expect(read("styles/globals.css")).toMatch(
    /@utility cover-letter \{\s*@apply font-serif text-xs leading-none text-fg-muted\/30 \[text-box:trim-both_cap_alphabetic\] @\[56px\]\/cover:text-lg @\[120px\]\/cover:text-3xl;/,
  );
  expect(letter).toContain('data-decorative=""');
  expect(letter).toContain('"@container/cover flex items-center justify-center"');
});

// SLN-822: the letter is the first letter or digit, uppercased, after any
// leading quote marks or punctuation: "«Quoted»" showed «, "études" é
it("shows the first letter or digit, uppercased", () => {
  expect(coverLetter("études")).toBe("É");
  expect(coverLetter("e\u0301tudes")).toBe("É");
  expect(coverLetter("«Quoted»")).toBe("Q");
  expect(coverLetter("\"'¿…Que?")).toBe("Q");
  expect(coverLetter("  the Waves")).toBe("T");
  expect(coverLetter("1984")).toBe("1");
  expect(coverLetter("Ἰλιάς")).toBe("Ἰ");
  expect(coverLetter("ßa")).toBe("ß");
  expect(coverLetter("…")).toBe("");
  expect(coverLetter("")).toBe("");
});

it("gets the whole title, never a letter cut from it", () => {
  const card = read("components/books/book-card.tsx");
  expect(card).toContain("<CoverPlaceholder title={title} />");
  expect(card).not.toContain("title[0]");
  expect(read("app/(catalogue)/library/[slug]/work-poster-image.tsx")).toContain("<CoverPlaceholder title={title} />");
});

// SLN-823: the initials sat 4 to 5px above their frame's middle (the serif's
// line box) and half a pixel left of it (letter spacing after the last letter)
it("centers a monogram's initials as the cover letter is", () => {
  const monogram = read("components/shared/no-photo.tsx");
  expect(monogram).toContain("leading-none text-fg-primary [text-box:trim-both_cap_alphabetic]");
  expect(monogram).not.toContain("tracking-wide");
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
