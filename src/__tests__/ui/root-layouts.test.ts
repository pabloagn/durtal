import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The app has no src/app/layout.tsx: each top-level group or segment is its
// own root and draws the document. One without a layout has no stylesheet, as
// the downloaded-books pages had (SLN-908).

const APP = path.resolve(__dirname, "../../app");

/** Whether a folder holds a page anywhere below it */
function hasPage(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory() ? hasPage(path.join(dir, entry.name)) : /^page\.(tsx|ts|jsx|js)$/.test(entry.name),
  );
}

const roots = readdirSync(APP, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "api" && hasPage(path.join(APP, entry.name)))
  .map((entry) => entry.name);

describe("root layouts", () => {
  it("finds the app's roots, the downloaded-books pages among them", () => {
    expect(roots).toEqual(expect.arrayContaining(["(catalogue)", "(offline)", "reader"]));
  });

  it.each(roots)("%s draws a whole document with the app's styles", (root) => {
    const file = path.join(APP, root, "layout.tsx");
    expect(existsSync(file), `${root}/layout.tsx`).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/<html\b|<MinimalRoot\b/);
    expect(source).toMatch(/globals\.css|minimal-root/);
  });
});
