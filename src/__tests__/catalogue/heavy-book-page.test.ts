import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-1163 (book page survey, items 1 and 3): a well-used book's page was
// 836 KB and took 1.19 s at 200 ms a query. The series shelf is capped; the
// reads that depend on others start as each one returns, not after the
// slowest; a shelf's cover marks are one class each and draw from the icon
// sprite; and the worst case has its own fixture and budget, apart from the
// gate until its editions and notes are slimmed (SLN-1132, SLN-1079).

const root = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const page = read("src/app/(catalogue)/library/[slug]/page.tsx");

describe("the book page's reads", () => {
  it("caps the series shelf like the others", () => {
    expect(page).toContain("getOtherWorksInSeries(work.seriesId, work.id, shelfLimit)");
    expect(read("src/lib/actions/series.ts")).toContain("order by abs(o.place - coalesce(here.place, 0)), o.place");
  });

  it("reads the cards' e-book marks beside the cards, from the shelves' picks", () => {
    expect(page).toContain("Promise.all([seriesShelf, relatedRows, similarRanks, markIds, relations]).then(");
    expect(page).toContain("relatedRows.then(relatedGroupsFrom)");
    expect(page).toContain("similarRanks.then(similarWorksFrom)");
    // One wait for the page's reads: the second Promise.all after it went
    expect(page.match(/await Promise\.all\(\[/g)).toHaveLength(2);
  });

  it("finds a book's collections in one wave", () => {
    const collections = read("src/lib/actions/collections.ts");
    const body = collections.slice(collections.indexOf("export async function getCollectionsForWork"));
    expect(body.slice(0, body.indexOf("return found.map"))).toMatch(/const \[memberships, asWork, found\] = await Promise\.all\(\[/);
  });
});

describe("a shelf card's cover marks", () => {
  it("are one class each, drawn from the sprite", () => {
    const chip = read("src/components/books/cover-chip.ts");
    expect(chip).toContain('export const COVER_CHIP = "cover-chip";');
    expect(chip).toContain('export const COVER_CHIP_ICON = "cover-chip-icon";');
    expect(chip).toContain('bottomLeft: "cover-corner-bl"');
    const css = read("src/styles/globals.css");
    for (const name of ["cover-chip", "cover-chip-icon", "cover-mark", "cover-corner-tl", "cover-corner-tr", "cover-corner-bl"])
      expect(css).toContain(`@utility ${name} {`);
    for (const [file, icon] of [["hunt-badge", "gem"], ["poison-badge", "skull"], ["ebook-mark", "book-open"]])
      expect(read(`src/components/books/${file}.tsx`)).toContain(`<CoverMark name="${icon}"`);
  });
});

describe("the heavy book's fixture", () => {
  it("has its own budget, and the gated book rows skip it", () => {
    const heavy = JSON.parse(read("scripts/qa/page-weight-heavy.json"));
    expect(heavy.routes).toEqual([{ path: "/library/survey-heavy-book", maxKB: 400, maxMs: 1000 }]);
    const gated = JSON.parse(read("scripts/qa/page-weight.json")).routes.filter((r: { path: string }) => r.path === "/library/*");
    expect(gated).toHaveLength(2);
    for (const row of gated) expect(row.skip).toContain("survey-heavy-book");
  });

  it("seeds only the disposable preview database", () => {
    expect(read("scripts/qa/seed-heavy-book.sql")).toContain("if current_database() <> 'durtal_preview' then");
    expect(read("scripts/qa/preview-local.py")).toContain('(Path(__file__).parent / "seed-heavy-book.sql").read_text()');
  });
});
