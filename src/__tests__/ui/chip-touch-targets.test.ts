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
    expect(fields).toContain('<span className="w-28 shrink-0 pt-px text-xs leading-6 text-fg-secondary pointer-coarse:leading-11 max-sm:');
    expect(fields).toMatch(/px-1\.5 pt-px text-xs leading-6 [^"]*pointer-coarse:leading-11 /);
    expect(fields).toContain('export const CHIP_NAME = "min-w-0 whitespace-normal break-words pointer-coarse:py-2.5 pointer-coarse:leading-6";');
  });

  it("gives a role chip's name a line of its own on touch and on a phone", () => {
    // Beside the role menu and cross, a house's name kept 38px at 320 on touch
    // and vanished with a mouse (reviews of #327 and #331)
    const fields = read("components/catalogue/record-fields.tsx");
    expect(fields).toContain("export const ROLE_CHIP = `${CHIP} pointer-coarse:flex-wrap max-sm:flex-wrap`;");
    expect(fields).toContain("export const ROLE_CHIP_NAME = `${CHIP_NAME} pointer-coarse:order-first pointer-coarse:basis-full max-sm:order-first max-sm:basis-full`;");
    const perfume = read("components/perfumes/perfume-fields.tsx");
    expect(perfume).toContain("<span key={`${entry.organizationId}:${entry.role}`} className={ROLE_CHIP}>");
    expect(perfume).toMatch(/<span className=\{ROLE_CHIP_NAME\}>\s*\{entry\.name\}/);
    expect(perfume).toContain("className={`${ROLE_CHIP_NAME} ${entry.personId ? \"\" : \"italic\"}`}");
    expect(read("components/paintings/painting-fields.tsx")).toContain("<span key={entry.key} className={ROLE_CHIP}>");
    expect(read("components/films/film-fields.tsx")).toContain("min-w-0 flex-1 whitespace-normal break-words pointer-coarse:basis-full max-sm:basis-full");
    // The menu keeps its width beside a name that wraps
    for (const file of ["components/perfumes/perfume-fields.tsx", "components/paintings/painting-fields.tsx"])
      expect(read(file)).not.toMatch(/<select[^>]*className="h-5 rounded-sm/);
  });

  it("wraps every chip's name in full at every width instead of cutting it", () => {
    // From 640 up, names over about 50 letters were still cut (review of #335)
    for (const file of ["components/catalogue/record-fields.tsx", "components/films/film-fields.tsx", "components/perfumes/perfume-fields.tsx", "components/paintings/painting-fields.tsx"])
      expect(read(file)).not.toMatch(/<span className="truncate|CHIP_NAME =\s*"truncate/);
  });

  it("puts a row's label over its chips on a phone, with a row-starting Add on the label's edge", () => {
    const fields = read("components/catalogue/record-fields.tsx");
    expect(fields).toContain('<div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 max-sm:flex-col">');
    // The field label's look (type-label: 14px, medium, 20px line), so it sits as far over its chips as a field's label over its input
    expect(fields).toContain("max-sm:w-auto max-sm:pt-0 max-sm:font-medium max-sm:leading-5 max-sm:pointer-coarse:leading-5");
    expect(fields).toContain('<div className="flex min-w-0 flex-1 flex-wrap items-start gap-1.5 max-sm:w-full max-sm:flex-none">');
    expect(fields).toMatch(/pointer-coarse:min-w-11 pointer-coarse:leading-11 max-sm:first:-ml-1\.5"/);
  });


  it("makes a house's role menu, date precision and checkbox lists 44px on touch", () => {
    expect(read("components/perfumes/perfume-fields.tsx")).toMatch(/aria-label=\{`Role of \$\{entry\.name\}`\}[\s\S]*?pointer-coarse:h-11 pointer-coarse:min-w-11"/);
    expect(read("components/shared/catalogue-date-field.tsx")).toContain('<label className="flex h-8 items-center gap-2 text-xs text-fg-secondary pointer-coarse:h-11">');
    expect(read("components/organizations/organization-dialog.tsx")).toContain('<label className="flex cursor-pointer items-center gap-2 text-sm text-fg-primary pointer-coarse:min-h-11">');
    expect(read("components/taxonomy/family-form.tsx")).toContain("has-[:disabled]:cursor-default pointer-coarse:min-h-11");
  });
});
