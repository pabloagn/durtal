import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// "Add release" is a ghost button that starts a row under the releases
// fieldset's text, so it pulls out by its own padding (docs/03, Spacing
// Scale) and its icon starts on the text edge. Without it the alignment audit
// read it 10px in. Browser layout is measured by hand; this pins the class.
it("starts Add release on the releases' text edge", () => {
  const source = readFileSync(path.resolve(__dirname, "../../components/films/version-dialog.tsx"), "utf8");
  const end = source.indexOf("Add release");
  const button = source.slice(source.lastIndexOf("<Button", end), end);
  expect(button).toMatch(/variant="ghost"/);
  expect(button).toMatch(/size="sm"/);
  expect(button).toMatch(/className="[^"]*-ml-2\.5[^"]*"/);
});

// A release's Remove cross was a 24px target on touch (third audit)
it("gives Remove release a 44px target on touch, on the label's cap height", () => {
  const source = readFileSync(path.resolve(__dirname, "../../components/films/version-dialog.tsx"), "utf8");
  const start = source.indexOf("aria-label={`Remove ${label.toLowerCase()}`}");
  expect(source.slice(source.lastIndexOf("<CapAligned", start), start)).toContain("coarseHeight={44}");
  expect(source.slice(start, source.indexOf(">", source.indexOf("className=", start)))).toContain("pointer-coarse:h-11 pointer-coarse:w-11");
});
