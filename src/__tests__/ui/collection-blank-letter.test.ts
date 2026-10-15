import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-778: a collection with no artwork showed a folder icon over a tiny
// letter, on its card and on its page. Every blank cover shows the title's
// letter (`CoverLetter`, #352); a chosen collection icon stays by the name

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

it("shows a collection's letter where it has no artwork, on its card and its page", () => {
  for (const file of ["components/collections/collection-card.tsx", "app/(catalogue)/collections/[id]/page.tsx"]) {
    const code = source(file);
    expect(code, file).toMatch(/<div className=\{`h-full \$\{COVER_BLANK\}`\}>\s*<CoverLetter title=\{collection\.name\} \/>/);
    expect(code, file).not.toContain("<FolderOpen");
  }
});
