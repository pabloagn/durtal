import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// On a touch screen every press target is 44px (docs/03, Keyboard, touch and
// motion). A record form's chips grow to one 44px line there, so their Remove
// and role menus are 44px, and the row's label and Add stay level with them.
// Browser behaviour is measured by hand; this pins the markup.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("Record form touch targets", () => {
  it("gives every chip's Remove a 44px box on touch, with no opt-in", () => {
    const fields = read("components/catalogue/record-fields.tsx");
    expect(fields).toMatch(/export const CHIP =\s*"[^"]*pointer-coarse:py-0 pointer-coarse:leading-11"/);
    expect(fields).toContain("<CapAligned height={16} coarseHeight={44}>");
    expect(fields).toMatch(/aria-label=\{label\}[\s\S]*?pointer-coarse:size-11"/);
    expect(fields).not.toContain("touchTarget");
  });

  it("keeps the row's label and Add on the chips' first line", () => {
    const fields = read("components/catalogue/record-fields.tsx");
    expect(fields).toContain('<span className="w-28 shrink-0 pt-px text-xs leading-6 text-fg-secondary pointer-coarse:leading-11">{label}</span>');
    expect(fields).toMatch(/px-1\.5 pt-px text-xs leading-6 [^"]*pointer-coarse:leading-11"/);
    for (const file of ["components/perfumes/perfume-fields.tsx", "components/paintings/painting-fields.tsx"])
      expect(read(file)).toContain("pointer-coarse:basis-full pointer-coarse:whitespace-normal pointer-coarse:break-words pointer-coarse:py-2.5 pointer-coarse:leading-6");
  });

  it("gives a house's name a line of its own on touch, as a credit's", () => {
    // Beside the 44px role menu and cross, the name kept 38px at 320 (review of #327)
    const perfume = read("components/perfumes/perfume-fields.tsx");
    expect(perfume).toContain("<span key={`${entry.organizationId}:${entry.role}`} className={`${CHIP} pointer-coarse:flex-wrap`}>");
    expect(perfume).toMatch(/className="truncate pointer-coarse:order-first pointer-coarse:basis-full [^"]*">\s*\{entry\.name\}/);
  });

  it("makes a house's role menu, date precision and checkbox lists 44px on touch", () => {
    expect(read("components/perfumes/perfume-fields.tsx")).toMatch(/aria-label=\{`Role of \$\{entry\.name\}`\}[\s\S]*?pointer-coarse:h-11 pointer-coarse:min-w-11"/);
    expect(read("components/shared/catalogue-date-field.tsx")).toContain('<label className="flex h-8 items-center gap-2 text-xs text-fg-secondary pointer-coarse:h-11">');
    expect(read("components/organizations/organization-dialog.tsx")).toContain('<label className="flex cursor-pointer items-center gap-2 text-sm text-fg-primary pointer-coarse:min-h-11">');
    expect(read("components/taxonomy/family-form.tsx")).toContain("has-[:disabled]:cursor-default pointer-coarse:min-h-11");
  });
});
