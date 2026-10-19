import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-917: the series Add books dialog cut author names with an ellipsis
// ("Maximiliana Wilhelmina Konstantinop..."). Titles and names wrap in full.
describe("the series Add books dialog", () => {
  const text = readFileSync(path.resolve(__dirname, "../..", "components/series/add-series-books-dialog.tsx"), "utf8");
  it("never truncates a title, a name or a series line", () => {
    expect(text).not.toMatch(/\btruncate\b/);
    expect(text).toContain("[overflow-wrap:anywhere]");
  });
});
