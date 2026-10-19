import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// The contrast survey (findings/contrast-survey-2026-10-15.md): text a
// reader needs passed everywhere, but two icon-only controls read under
// 3:1, placeholders on lighter surfaces just under 4.5:1, and disabled
// controls at 1.4 to 2.2:1. Each is a shared token or component.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

it("keeps a placeholder at 4.5:1 on every opaque surface", () => {
  const css = read("styles/globals.css");
  const token = (name: string) => css.match(new RegExp(`--color-${name}: (#[0-9a-f]{6});`))![1];
  for (const surface of ["bg-primary", "bg-secondary", "bg-tertiary"]) {
    expect(contrast(token("fg-muted"), token(surface)), surface).toBeGreaterThanOrEqual(4.5);
  }
  // The collections list's search is the shared toolbar's field (SLN-845)
  expect(read("components/shared/entity-filters.tsx")).toContain("placeholder:text-fg-muted");
});

it("draws the unmarked mark toggles and the comment box's icons in fg-muted, not a faded tint", () => {
  expect(read("components/books/mark-toggle.tsx")).toContain('"text-fg-muted hover:text-fg-secondary"');
  expect(read("components/books/mark-toggle.tsx")).not.toContain("text-fg-muted/70");
  expect(read("components/activity/comment-editor.tsx")).not.toContain("text-fg-muted/50");
});

it("shows a disabled control at 60%: quiet, but readable", () => {
  expect(read("styles/globals.css")).toContain("disabled:pointer-events-none disabled:opacity-60;");
  expect(read("components/shared/pager-control.ts")).toContain("disabled:opacity-60");
  expect(read("components/ui/select.tsx")).toContain("disabled:opacity-60");
  const carousel = read("components/shared/horizontal-carousel.tsx");
  expect(carousel.match(/text-fg-secondary [^"]*disabled:opacity-60/g)).toHaveLength(2);
});
