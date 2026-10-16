import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-803: a work with no cover showed its initials ("AN") in the command
// palette, where every other blank cover shows the title's letter (#352).
// People keep their initials, as on their cards

const palette = readFileSync(path.resolve(__dirname, "../../components/layout/command-palette.tsx"), "utf8");

it("shows a blank work's title letter, and a person's initials", () => {
  // A thumb that fails counts as none (broken-images survey, SLN-858)
  expect(palette).toContain("const shown = src === failedSrc ? null : src;");
  expect(palette).toContain('const blankWork = !shown && kind === "book";');
  expect(palette).toMatch(/blankWork \? \(\s*<CoverLetter title=\{name\} \/>\s*\) : \(\s*<span aria-hidden="true" className="font-serif text-micro leading-none text-fg-primary \[text-box:trim-both_cap_alphabetic\]">\s*\{initials\.toUpperCase\(\)\}/);
  // the letter's box is the cover container, with no name tint behind it
  expect(palette).toContain('${blankWork ? COVER_BLANK : "flex items-center justify-center"}');
  expect(palette).toContain("style={shown || blankWork ? undefined : monogramTint(name)}");
});
