import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";
import { BOOK_LINK_SITES } from "@/lib/validations/book-links";

// Placeholders that fit a 320px phone (SLN-946): a full-width field there holds
// about 28 letters at 14px. A format the reader needs moves to the hint line.

const read = (path: string) => readFileSync(path, "utf8");

describe("Input hint", () => {
  it("shows a hint line under the field and names it as the field's description", () => {
    const html = renderToStaticMarkup(createElement(Input, { id: "f", label: "Name", hint: "Left empty, it is made from the name" }));
    expect(html).toContain('aria-describedby="f-hint"');
    expect(html).toContain('<p id="f-hint" class="text-xs text-fg-secondary">Left empty, it is made from the name</p>');
  });

  it("gives the hint's place to an error", () => {
    const html = renderToStaticMarkup(createElement(Input, { id: "f", hint: "A hint", error: "Too long" }));
    expect(html).toContain('aria-describedby="f-error"');
    expect(html).not.toContain("A hint");
  });

  it("keeps a description the caller passes", () => {
    const html = renderToStaticMarkup(createElement(Input, { id: "f", error: "Too long", "aria-describedby": "other" }));
    expect(html).toContain('aria-describedby="f-error other"');
  });
});

describe("placeholders fit a phone", () => {
  const SHORTENED: [string, string][] = [
    ["src/components/authors/author-form.tsx", 'placeholder="Last, First"'],
    ["src/app/(catalogue)/places/venue-create-dialog.tsx", 'placeholder="e.g. rare books, first editions"'],
    ["src/components/venues/google-places-search.tsx", 'placeholder = "Search for a place…"'],
    ["src/components/series/series-form-dialog.tsx", 'placeholder="e.g. La Comédie humaine"'],
    ["src/components/taxonomy/family-form.tsx", 'placeholder="e.g. Reading mood"'],
    ["src/components/films/version-dialog.tsx", 'placeholder="e.g. Director’s cut"'],
    ["src/components/paintings/art-object-dialog.tsx", 'placeholder="e.g. framed, 95 × 120 cm"'],
    ["src/components/paintings/painting-form.tsx", 'placeholder="e.g. The Night Watch"'],
    ["src/app/(catalogue)/library/new/steps/search-step.tsx", 'placeholder="Title, author or ISBN"'],
    ["src/components/books/match-again-dialog.tsx", 'placeholder="Title, author or ISBN"'],
    ["src/components/catalogue/sources-section.tsx", 'placeholder="https://"'],
    ["src/components/catalogue/work-relations.tsx", 'placeholder="https://"'],
    ["src/components/reading/dialogs/log-progress-dialog.tsx", 'placeholder="212, 44% or +20"'],
  ];

  it.each(SHORTENED)("%s has its short placeholder", (path, placeholder) => {
    expect(read(path)).toContain(placeholder);
  });

  it("book links show the site's address without the scheme", () => {
    for (const site of Object.values(BOOK_LINK_SITES)) {
      expect(site.placeholder.startsWith("https://")).toBe(false);
      expect(site.placeholder.length).toBeLessThanOrEqual(26);
    }
  });

  it("sources name a short example on every kind", () => {
    for (const kind of ["films", "paintings", "perfumes"]) {
      const name = read(`src/app/(catalogue)/${kind}/[slug]/page.tsx`).match(/examples=\{\{\s*name: "([^"]+)"/)?.[1];
      expect(name, kind).toBeDefined();
      expect(name!.length, kind).toBeLessThanOrEqual(26);
    }
  });

  it("keeps the formats a reader needs in the hint line", () => {
    expect(read("src/components/reading/dialogs/log-progress-dialog.tsx")).toContain('hint="212, 44%, +20, 212/480, 3:12 or ch 7"');
    expect(read("src/components/catalogue/sources-section.tsx")).toContain('hint="None for a book or a box"');
    expect(read("src/components/films/version-dialog.tsx")).toContain('hint="Leave it empty when the version has no name"');
    expect(read("src/components/authors/author-form.tsx")).toContain('"Left empty, it is made from the name"');
  });

  it("stacks the narrow pairs on a phone, so their hints show whole", () => {
    // The quote's Page and Chapter, and a place's Type and Subtype
    expect(read("src/components/reading/dialogs/note-dialog.tsx")).toContain('<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">\n          <div className="space-y-1">');
    expect(read("src/app/(catalogue)/places/venue-create-dialog.tsx")).toContain('<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">\n                  <Select\n                    id="venue-type"');
  });
});
