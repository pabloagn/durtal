import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-1029: a remove with no confirmation (a work's link, a source, an
// acquisition target, a venue's institution) took its row and the focus fell
// to the body. These lists now carry FocusKeeper's marks, so the focus goes to
// the next row's Remove, else the section's Add. Each was checked in
// Chromium, Firefox and WebKit; this pins the marks.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

const LISTS: [file: string, list: string][] = [
  ["components/catalogue/work-relations.tsx", "relations"],
  ["components/catalogue/sources-section.tsx", "sources"],
  ["components/publishers/acquisition-targets.tsx", "acquisition-targets"],
  ["app/(catalogue)/places/[slug]/venue-institutions.tsx", "venue-institutions"],
];

describe("removes keep the focus", () => {
  it.each(LISTS)("%s marks its list %s, its rows and its Add", (file, list) => {
    const source = read(file);
    expect(source).toContain(`data-focus-list="${list}"`);
    expect(source).toContain('data-focus-row=""');
    expect(source).toContain(`data-focus-empty="${list}"`);
  });

  it("hands a book's focus to its actions menu, which holds Link a work, once the last link goes", () => {
    expect(read("components/shared/entity-action-menu.tsx")).toContain("data-focus-empty={focusEmpty}");
    expect(read("app/(catalogue)/library/[slug]/work-actions-menu.tsx")).toContain('<EntityActionMenu items={actionItems} focusEmpty="relations" />');
  });

  it("holds a pressed Remove busy rather than disabling it, so the focus stays on it", () => {
    const sources = read("components/catalogue/sources-section.tsx");
    expect(sources).not.toContain("disabled={removing === source.id}");
    expect(sources).toContain("aria-disabled={removing === source.id || undefined}");
    const targets = read("components/publishers/acquisition-targets.tsx");
    expect(targets).toMatch(/aria-label=\{`Remove target: \$\{targetName\(t\)\}`\}[\s\S]*?busy=\{busy === `remove:\$\{target.id\}`\}\s*aria-disabled=\{pending \|\| undefined\}/);
  });
});
