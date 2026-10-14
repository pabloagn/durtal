import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// On a phone the Compact card size is two cards a row with an 8px gap and
// 8px card padding. A container too narrow for two (a 320px phone) keeps one
// ordinary card a row, so its text sits at the usual 14px (SLN-641). The cards
// are containers of their own, so the grid hands the inset down in a custom
// property. Browser layout is measured by hand; this pins the rule.
it("tightens cards only where the phone grid holds two a row", () => {
  const css = readFileSync(path.resolve(__dirname, "../../styles/globals.css"), "utf8");
  const block = css.slice(css.indexOf("@container (min-width: 328px)"));
  const query = block.slice(0, block.indexOf("\n  }\n"));
  expect(query).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  expect(query).toContain("gap: 8px");
  expect(query).toContain("--compact-inset: 8px");
  expect(css).toContain(".catalogue-density-compact > * .card-body { padding: var(--compact-inset, 0.875rem); }");
  expect(css).not.toMatch(/\.catalogue-density-compact \{ gap: 8px; \}/);
});
