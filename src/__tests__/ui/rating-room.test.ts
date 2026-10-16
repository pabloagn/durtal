import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");
/** Tailwind spacing steps to px: "3.75" is 15px */
const px = (step: string) => Number(step) * 4;

// The rating input reaches past its column so its first star starts on the
// text edge (SLN-641). The work form scrolls inside its dialog, and a scroller
// clips what reaches past it: without room on its left, the first star lost
// 5px of its target with a mouse and 15px on touch, and its focus ring its
// left side. Since pass 5 (SLN-847) the dialog's body is the form's one
// scroller, so its own side padding is that room. Browser layout is measured
// by hand; this pins the room.
it("leaves the work form's scroller room for the rating's first star and its focus ring", () => {
  const pull = read("components/shared/rating.tsx").match(/14: "-ml-[\d.]+ pointer-coarse:-ml-([\d.]+)"/);
  expect(pull).not.toBeNull();
  // No scroller of the form's own inside the dialog's
  expect(read("components/books/work-form.tsx")).not.toMatch(/max-h-\[75vh\]/);
  const body = read("components/ui/dialog.tsx").match(/ref=\{bodyRef\} className=\{`([^`]*)`\}/)?.[1].split(" ") ?? [];
  expect(body).toContain("overflow-y-auto");
  const room = body.find((c) => /^px-[\d.]+$/.test(c))?.slice(3);
  // The touch pull, plus the 2px ring and its 2px offset
  expect(px(room ?? "0")).toBeGreaterThanOrEqual(px(pull![1]) + 4);
});
