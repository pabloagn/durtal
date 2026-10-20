import { expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

// SLN-873 (hover-focus survey, item 6): every control outside the reader
// shows the one focus mark, the global 2px steel outline (globals.css). A
// chart's frame drew a 1px, 60% ring on its edge, over its axis labels, and
// seven controls a 1px ring of their own. The chart's outline stands 4px out,
// clear of its labels; the small controls inset theirs, as `action-control`
// does, since a cap box or a dialog's scroll clips an outline that stands out.

const src = path.resolve(__dirname, "../..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : files(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

it("leaves no thin focus ring outside the reader", () => {
  const thin = files(src)
    .filter((file) => !/[\\/]reader[\\/]/.test(file))
    .filter((file) => readFileSync(file, "utf8").includes("focus-visible:ring-1"))
    .map((file) => path.relative(src, file));
  expect(thin).toEqual([]);
});

it("insets the outline on small controls, so a cap box or a dialog cannot clip it", () => {
  for (const file of [
    "components/films/version-dialog.tsx",
    "components/shared/credit-row-controls.tsx",
    "components/media/logo-card-upload.tsx",
    "components/catalogue/record-fields.tsx",
    "components/taxonomy/taxonomy-assignments.tsx",
    "app/(catalogue)/taxonomy/taxonomy-actions.tsx",
  ])
    expect(readFileSync(path.join(src, file), "utf8"), file).toContain("focus-visible:-outline-offset-2");
});

it("lets a chart's frame take the global outline", () => {
  const frame = readFileSync(path.join(src, "components/reading/charts/chart-frame.tsx"), "utf8");
  expect(frame).not.toContain("focus-visible:ring");
  expect(frame).toContain('className="rounded-sm focus-visible:outline-offset-4"');
});

it("keeps a bar chart's labels inside its frame, clear of that outline", () => {
  const bars = readFileSync(path.join(src, "components/reading/charts/bar-chart.tsx"), "utf8");
  // "800 or more" beside a phone's bars and "2,000" on the tick gutter outgrew fixed widths
  expect(bars).toContain("const labelWidth = Math.max(72, 6 + textWidth(bars.map((b) => b.label)));");
  expect(bars).toContain('const left = Math.max(36, 6 + textWidth(marks.map((t) => t.toLocaleString("en-US"))));');
  expect(bars).not.toMatch(/const (labelWidth|left) = \d+;/);
});
