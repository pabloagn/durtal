import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// The hover and focus survey, item 4 (SLN-871): Chromium draws no focus ring
// round an inline link whose only child is a block, so the suggestion titles
// showed none there. The browser check rests on this markup.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("a suggestion's title link", () => {
  it("is a block round its one-line title, as the hidden list's is", () => {
    const list = read("components/reading/suggestions/suggestion-list.tsx");
    const link = list.match(/<Link href=\{row\.href\} className="([^"]*)">\s*<span className="lines-1">\{row\.title\}<\/span>/);
    expect(link).not.toBeNull();
    expect(link![1].split(" ")).toContain("block");
  });
});
