import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// On touch, every control's press area is 44px. Where neighbours' areas
// crossed (a tap on an author's name toggled a collector mark) or sat closer
// than 8px, the gaps grow under a coarse pointer only, so desktop layouts stay
// as they were. Measured in Chromium and WebKit at 390 and 320 (task 0821).
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("press areas that crossed", () => {
  it("keeps the book's marks clear of the author link", () => {
    const page = read("app/(catalogue)/library/[slug]/page.tsx");
    expect(page).toContain('<div className="mt-2 flex flex-wrap items-center gap-1 pointer-coarse:mt-4">');
    expect(page).toContain('<div className="mt-2 flex flex-wrap items-start gap-3 py-1 font-mono text-xs pointer-coarse:mt-7">');
    expect(page).toContain('className="-mx-1.5 flex items-center pointer-coarse:mx-0 pointer-coarse:gap-2"');
  });

  it("spaces wrapped eBook state counts and record facts", () => {
    expect(read("app/(catalogue)/ebooks/page.tsx")).toContain("pointer-coarse:-mt-4 pointer-coarse:gap-y-8");
    for (const file of ["app/(catalogue)/paintings/[slug]/page.tsx", "app/(catalogue)/perfumes/[slug]/page.tsx"])
      expect(read(file), file).toContain("gap-y-2 text-sm pointer-coarse:mt-8 pointer-coarse:gap-y-8");
  });

  it("keeps a chip's cross inside it and its rows apart", () => {
    const chips = read("components/taxonomy/taxonomy-assignments.tsx");
    expect(chips).toContain('<div className="space-y-3 pointer-coarse:space-y-6.5">');
    expect(chips).toContain("gap-1.5 pointer-coarse:gap-x-4 pointer-coarse:gap-y-6.5");
    expect(chips).toContain("text-fg-secondary pointer-coarse:pr-4");
  });
});

describe("shared controls 8px apart on touch", () => {
  it.each([
    ["components/books/view-mode-switcher.tsx", "border-glass-border pointer-coarse:gap-[clamp(4px,"],
    ["components/reading/reading-tabs.tsx", "flex flex-wrap gap-1 pointer-coarse:gap-2"],
    ["components/settings/settings-nav.tsx", "flex flex-wrap gap-1 pointer-coarse:gap-2"],
    ["components/domains/domain-switch.tsx", "flex flex-wrap gap-1 pointer-coarse:gap-2"],
    ["components/shared/entity-filters.tsx", "flex items-center gap-1 pointer-coarse:gap-2"],
    ["components/ui/dialog.tsx", "flex items-center gap-1 pointer-coarse:gap-2"],
    ["components/shared/tiptap-editor.tsx", "gap-0.5 pointer-coarse:gap-2"],
    ["components/shared/rich-text-editor.tsx", "gap-0.5 pointer-coarse:gap-2"],
    ["components/reading/suggestions/suggestion-list.tsx", "gap-1 pointer-coarse:gap-2"],
    ["styles/globals.css", "flex gap-0.5 pointer-coarse:gap-2 rounded-sm"],
  ])("%s", (file, classes) => {
    expect(read(file)).toContain(classes);
  });

  it("gives the phone header's buttons room on both sides", () => {
    const bar = read("components/layout/mobile-nav-bar.tsx");
    expect(bar).toContain('<div className="flex w-full gap-2 font-serif text-lg tracking-tight">');
    expect(bar).toContain('<div className="ml-auto flex gap-2">');
  });

  it("keeps the compact pager's narrow gap to fine pointers", () => {
    expect(read("components/shared/pagination.tsx")).toContain('compact ? "not-pointer-coarse:max-sm:gap-1" : ""');
  });
});
