import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish pass 4, item 2 (SLN-830): every blank picture is the title's
// letter. Films and paintings showed a framed title card, perfumes a drawn
// bottle with two initials, places "MUSEUM / Online", and the Books and
// Collections mosaics the title card.

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

const BLANK = "<span className={`absolute inset-0 ${COVER_BLANK}`}>";

describe("blank pictures", () => {
  it.each([
    "components/films/film-poster.tsx",
    "components/paintings/painting-image.tsx",
    "components/perfumes/perfume-image.tsx",
    "components/venues/venue-card.tsx",
    "components/domains/domain-tile.tsx",
    "components/books/library-view.tsx",
    "components/collections/collections-view.tsx",
  ])("%s shows the letter", (file) => {
    const code = source(file);
    expect(code).toContain(BLANK);
    expect(code).toMatch(/<CoverLetter title=\{/);
    expect(code).not.toMatch(/TitleCard|Flacon|PlacePlate/);
  });

  it("have no other stand-in left for a work", () => {
    const noPhoto = source("components/shared/no-photo.tsx");
    for (const gone of ["TitleCard", "Flacon", "PlacePlate"]) {
      expect(noPhoto).not.toContain(`function ${gone}`);
    }
    expect(source("styles/globals.css")).not.toContain("@utility flacon");
  });
});
