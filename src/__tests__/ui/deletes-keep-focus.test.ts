import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-1028: a confirmed delete closed its dialog onto the row's menu, then the
// refresh took the row and the focus fell to the body. These lists now carry
// FocusKeeper's marks, so the focus goes to the next row, else the section's
// Add. Each was checked in Chromium, Firefox and WebKit; this pins the marks.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

const LISTS: [file: string, list: string, empty: boolean][] = [
  ["components/films/copies-section.tsx", "film-copies", true],
  ["components/films/versions-section.tsx", "film-versions", true],
  ["components/perfumes/bottles-section.tsx", "perfume-bottles", true],
  ["components/perfumes/formulations-section.tsx", "perfume-formulations", true],
  ["components/perfumes/retailers-section.tsx", "perfume-retailers", true],
  ["components/catalogue/wanted-section.tsx", "wanted", true],
  ["app/(catalogue)/library/[slug]/page.tsx", "editions", false],
  ["components/reading/reading-section.tsx", "book-readings", false],
  ["components/books/book-grid.tsx", "books", false],
  ["app/(catalogue)/people/authors-shell.tsx", "people", false],
  ["components/shared/mosaic.tsx", "mosaic", false],
];

describe("deletes keep the focus", () => {
  it.each(LISTS)("%s marks its list %s", (file, list, empty) => {
    const source = read(file);
    expect(source).toContain(`data-focus-list="${list}"`);
    if (empty) expect(source).toContain(`data-focus-empty="${list}"`);
  });

  it("marks the rows of the lists whose rows live elsewhere", () => {
    for (const file of ["components/books/book-card.tsx", "components/authors/author-card.tsx", "components/authors/author-list-item.tsx"])
      expect(read(file), file).toContain('data-focus-row=""');
    expect(read("app/(catalogue)/library/[slug]/edition-add-dialog.tsx")).toContain('data-focus-empty="editions"');
    expect(read("components/reading/reading-control.tsx")).toContain('data-focus-empty="book-readings"');
  });

  it("gives a painting's originals and reproductions a list each", () => {
    const source = read("components/paintings/art-objects-section.tsx");
    for (const list of ["painting-originals", "painting-reproductions"]) {
      expect(source).toContain(`list(${list === "painting-originals" ? "originals" : "reproductions"}, "${list}")`);
      expect(source).toContain(`data-focus-empty="${list}"`);
    }
  });

  it("names every reading's menu with the same first word, so the next one is found by it", () => {
    const source = read("components/reading/reading-section.tsx");
    expect(source).toContain('label="More reading actions"');
    expect(source).toContain("label={`More actions for the ${ordinalRead(row.ordinal)}`}");
  });

  it("holds a collection card's Move at an end, never disabling it, and refocuses it after a move", () => {
    const controls = read("components/collections/collection-controls.tsx");
    expect(controls).not.toMatch(/disabled=\{(first|last)\}/);
    expect(controls).toContain("aria-disabled={first || busy === -1 || undefined}");
    expect(controls).toContain("aria-disabled={last || busy === 1 || undefined}");
    expect(controls).toContain("startRefresh(() => router.refresh())");
    expect(controls).toMatch(/\(atEnd \? other : pressed\)\?\.focus/);
  });
});
