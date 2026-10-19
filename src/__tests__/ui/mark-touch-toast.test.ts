import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-1150: on touch, Mark as rare and Mark as anathema changed the record
// with no word of what they did. They now say it in a toast; a mouse keeps
// the tooltip and the hover card. Checked with touch in Chromium.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../../components/books", file), "utf8");

describe("mark toggles on touch", () => {
  it("say what they did, on a coarse pointer only", () => {
    const toggle = read("mark-toggle.tsx");
    expect(toggle).toContain('if (!window.matchMedia?.("(pointer: coarse)").matches) return;');
    expect(toggle).toContain("toast.success(marked ? `Marked as ${name}` : `No longer ${name}`);");
  });

  it("confirm the rare and anathema toggles from the saved state, not the date change", () => {
    expect(read("poison-toggle.tsx")).toContain("confirmMarkOnTouch(MARKS.poison, isPoison);");
    const rare = read("hunt-assessment-control.tsx");
    expect(rare).toContain("if (toggled) confirmMarkOnTouch(MARKS.rare, next.isRare);");
    expect(rare).toContain("onDateChange={(date) => save({ isRare: true, huntAssessedOn: date })}");
  });
});
