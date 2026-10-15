import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Main audit 2026-10-15 (SLN-721, SLN-722). Both live in components that
// need the database or the palette's data, so this pins the markup the
// browser checks rest on.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("text that wraps at its natural breaks on a phone", () => {
  it("keeps each journal count whole, breaking only between counts", () => {
    // At 390px it broke as "0 re- / reads"
    const page = read("app/(catalogue)/reading/journal/page.tsx");
    // At 320px it broke as "2 abandoned / · 3 re-reads": the dot stays with the count before it
    expect(page).toContain('{index > 0 && " "}<span className="whitespace-nowrap">{part}{index < parts.length - 1 && "\\u00a0·"}</span>');
  });

  it("puts a book's author on its own line in the palette on a phone, never cut off", () => {
    // At 390px it read "The Cathedral · Joris-Karl Hu…"
    const palette = read("components/layout/command-palette.tsx");
    expect(palette).toContain('<span className="min-w-0 flex-1 truncate max-sm:whitespace-normal max-sm:break-words">');
    expect(palette).toContain('<span className="text-fg-secondary max-sm:block">');
    expect(palette).toContain('<span className="max-sm:hidden">{"  ·  "}</span>');
  });
});
