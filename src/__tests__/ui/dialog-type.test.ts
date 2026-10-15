import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// A native dialog inherits type from where it is mounted. A detail page's
// dialogs are mounted in its serif title row (type-page-title), and opened in
// Cirka with the title's tracking. The base styles give every dialog the
// document's type, in the base layer so a dialog's own classes still win.
const css = readFileSync(path.join(process.cwd(), "src/styles/globals.css"), "utf8");

describe("dialog type", () => {
  it("resets a dialog's inherited type in the base layer", () => {
    const layer = [...css.matchAll(/@layer base \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
    const rule = layer.match(/\bdialog \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("font-family: var(--font-sans)");
    expect(rule).toContain("font-size: var(--text-sm)");
    expect(rule).toContain("letter-spacing: normal");
    expect(rule).toContain("font-weight: 400");
    // Not outside a layer, where it would beat the dialog's utility classes
    const unlayered = css.replace(/@layer base \{[\s\S]*?\n\}/g, "");
    expect(unlayered).not.toMatch(/(^|\n)dialog \{/);
  });
});
