import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Four phone-layout notes (SLN-879, from the phone-layout survey). The
// browser layout is measured by hand at 390 and 320; this pins the classes
// it rests on.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("phone layout notes", () => {
  it("lays four collection tabs out two by two in a row too narrow for one line", () => {
    const tabs = read("components/domains/domain-switch.tsx");
    expect(tabs).toContain('aria-label="Collections" className="@container');
    expect(tabs).toContain('kinds.length > 3 ? "max-sm:@max-[21rem]:grid max-sm:@max-[21rem]:grid-cols-2"');
    // One row elsewhere, each tab at least as wide as its label
    expect(tabs).toContain("max-sm:flex-nowrap max-sm:overflow-x-auto");
    expect(tabs).toContain('className="max-sm:flex-1"');
    expect(tabs).not.toContain("auto-cols-[minmax(max-content,1fr)]");
  });

  it("keeps a collection's four header buttons on one row: the labelled ones drop their icons when narrow", () => {
    const controls = read("components/collections/collection-controls.tsx");
    expect(controls).toContain('const NARROW_NO_ICON = "@max-[19rem]:[&>svg]:hidden";');
    expect(controls.match(/className=\{NARROW_NO_ICON\}/g)).toHaveLength(3);
    // Delete is icon-only, so it keeps its icon
    expect(controls).toMatch(/aria-label="Delete collection"(?![^>]*NARROW_NO_ICON)/);
  });

  it("never breaks a taxonomy family's name to make room for its badge", () => {
    const shell = read("app/(catalogue)/taxonomy/[familySlug]/taxonomy-family-shell.tsx");
    expect(shell).toContain('<h1 className="type-page-title inline [overflow-wrap:anywhere]">');
    expect(shell).toContain('{family.isSystem && " "}');
    expect(shell).toMatch(/<span className="inline-block h-5 -my-2\.5 align-\[0\.5cap\]">\s*<span className="float-left flex h-5 items-center">\s*<Badge variant="muted">System<\/Badge>/);
  });

  it("shows suggested and hidden titles and authors in full", () => {
    for (const file of ["components/reading/suggestions/suggestion-list.tsx", "components/reading/suggestions/hidden-list.tsx"]) {
      const list = read(file);
      expect(list, file).not.toContain("lines-1");
      expect(list, file).toContain('text-xs text-fg-secondary [overflow-wrap:anywhere]">{row.author}</p>');
    }
  });
});
