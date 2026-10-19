import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-1149: a phone held sideways (touch on a short screen) shows no key
// hints, starts with the icon rail and gets the phone's sort menu. The
// browsers are measured by hand at 844×390; this pins the rules.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

it("defines one variant for a phone held sideways", () => {
  expect(read("styles/globals.css")).toContain(
    "@custom-variant sideways (@media (pointer: coarse) and (max-height: 600px));",
  );
});

it("shows key hints only with a fine pointer", () => {
  const palette = read("components/layout/command-palette.tsx");
  expect(palette).toMatch(/className="hidden items-center gap-4 border-t [^"]*pointer-fine:flex"/);
  expect(palette).toContain('<span className="hidden pointer-fine:contents">\n          <KeyCombo');
  expect(read("components/layout/sidebar.tsx")).toContain('isCollapsed ? "" : "md:pointer-fine:inline"');
});

it("starts a sideways phone with the icon rail", () => {
  expect(read("lib/hooks/use-sidebar-preference.ts")).toContain(
    "(min-width: 768px) and (pointer: coarse) and (max-height: 600px)",
  );
});
