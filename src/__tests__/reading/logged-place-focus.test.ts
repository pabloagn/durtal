import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Review of #523: "Jump to p. 120" and "Stay at this place" leave the bar
// when pressed, so the focus fell to the page; it goes to the tracking
// control that takes their place.
const source = readFileSync(path.resolve(__dirname, "../../components/reading/reader-tracking.tsx"), "utf8");

describe("the logged-place jump hands the focus on (SLN-931)", () => {
  it("moves the focus to the tracking control after a jump or a dismiss", () => {
    expect(source).toMatch(/ref=\{statusRef\}/);
    expect(source).toMatch(/const jumpDone = \(at: number \| null\) => \{[\s\S]*?statusRef\.current\?\.querySelector<HTMLElement>\("button"\)\?\.focus\(\)/);
    expect(source).toMatch(/if \(moved && live\.current\) jumpDone\(at\)/);
    expect(source).toMatch(/aria-label="Stay at this place"[^>]*\n?\s*onClick=\{\(\) => jumpDone\(reading\.percent\)\}/);
  });
});
