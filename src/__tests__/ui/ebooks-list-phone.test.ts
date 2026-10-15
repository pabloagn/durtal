import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-799: on a phone the eBooks list was a table wider than the screen,
// "Read" ran into the title ("The Broken SealRead") and the sort headers
// were 31px tall on touch

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("the eBooks list on a phone", () => {
  const row = source("components/ebooks/ebook-row.tsx");
  const view = source("app/(catalogue)/ebooks/ebooks-view.tsx");

  it("stacks each row where the columns would not fit: title, author, then formats and size", () => {
    const tds = row.match(/<td className="[^"]*"/g) ?? [];
    // the cover and the title stay; every other column hides
    expect(tds[0]).not.toContain("hidden");
    expect(tds[1]).not.toContain("hidden");
    expect(tds.slice(2).every((td) => td.includes("@max-[52rem]:hidden"))).toBe(true);
    expect(tds[1]).toContain("@min-[52rem]:min-w-[13rem]");
    expect(row).toMatch(/@min-\[52rem\]:hidden">\s*\{authors\}/);
    expect(row).toMatch(/@min-\[52rem\]:hidden">[\s\S]*?formatLabel[\s\S]*?formatBytes\(book\.sizeBytes\)/);
  });

  it("keeps Read apart from the title, on its first line", () => {
    expect(row).toMatch(/flex items-start justify-between gap-3">[\s\S]*?<div className="min-w-0[^"]*">\s*<Link[^>]*>\{book\.title\}<\/Link>\s*<\/div>[\s\S]*?<CapAligned height=\{32\} coarseHeight=\{44\}>\s*<ReaderEntryLink/);
  });

  it("sorts from the sort row, and the headers are 44px on touch where the table stays", () => {
    expect(view).toContain('<div className="@container overflow-x-auto">');
    expect(view).toContain('<thead className="@max-[52rem]:hidden">');
    expect(view).toContain('className="touch-hit whitespace-nowrap pointer-coarse:min-h-11"');
  });
});
