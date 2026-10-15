import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Merging people deletes the duplicates for good, and merging a taxonomy item
// removes it. Enter and ⌘Enter press a dialog's primary button (or its
// `data-shortcut="save"`), and a native form submits on Enter in a field, so
// Merge is a danger button outside any form: it takes a click, or Tab then
// Enter (docs/15_KEYBOARD.md, "The main button is never a danger button").
// Browser behaviour is measured by hand; this pins the markup.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");
const mergeButton = (source: string) =>
  source.match(/<Button\s([^>]*?onClick=\{[^}]*handleMerge[^}]*\}[^>]*)>/)?.[1] ?? "";

describe("Merge confirmations", () => {
  it("Merge people is a danger button that Enter never presses", () => {
    const source = read("app/(catalogue)/people/[slug]/author-merge-dialog.tsx");
    const button = mergeButton(source);
    expect(button).toContain('variant="danger"');
    expect(button).not.toContain("data-shortcut");
  });

  it("Merge item is a danger button outside a form", () => {
    const source = read("components/taxonomy/merge-dialog.tsx");
    const button = mergeButton(source);
    expect(button).toContain('variant="danger"');
    expect(button).toContain('type="button"');
    expect(button).not.toContain("data-shortcut");
    expect(source).not.toMatch(/<form\b/);
  });

  it("picking a duplicate keeps focus in the search", () => {
    const source = read("app/(catalogue)/people/[slug]/author-merge-dialog.tsx");
    expect(source).toMatch(/function addSource[^}]*searchRef\.current\?\.focus\(\)/);
    expect(source).toMatch(/<input\s+ref=\{searchRef\}/);
  });

  it("gives the search, its results and a chip's Remove 44px on touch, on the name's first line", () => {
    const people = read("app/(catalogue)/people/[slug]/author-merge-dialog.tsx");
    expect(people).toMatch(/placeholder="Search for duplicates\.\.\."\s+className="[^"]*pointer-coarse:h-11/);
    expect(people).toMatch(/onClick=\{\(\) => addSource\(a\)\}\s+className="[^"]*pointer-coarse:min-h-11/);
    expect(people).toMatch(/<CapAligned height=\{12\} coarseHeight=\{44\}>\s*<button\s+aria-label=\{`Remove \$\{s\.name\}`\}/);
    // Beside the kept person a phone left the chips 90px: a 44px cross
    // squeezed "Seed Person 101" to 13 lines at 320px (review of #323)
    expect(people).toContain('<div className="flex items-start gap-3 max-sm:flex-col">');
    expect(people).toContain('<CapAligned height={16} className="text-xs max-sm:hidden">');
    expect(people).toContain('<div className="min-w-0 sm:flex-shrink-0 sm:text-right">');
    const taxonomy = read("components/taxonomy/merge-dialog.tsx");
    expect(taxonomy).toMatch(/onClick=\{\(\) => setTargetId\(target\.id\)\}\s+className=\{`[^`]*pointer-coarse:min-h-11/);
  });
});
