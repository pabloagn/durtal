import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A menu never sits in CapAligned (PR #108 review): its box clips, so an open
 * menu drawn inside it shows as a sliver whose items cannot be clicked. A
 * menu beside text goes in CapAlignedControls, whose box clips nothing.
 */

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));

/** Every <CapAligned ...>...</CapAligned> block in the app, with its file */
const blocks = files("src").flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/<CapAligned[\s>][\s\S]*?<\/CapAligned>/g)].map((m) => ({ file, text: m[0] })),
);

describe("CapAligned blocks", () => {
  it("are found across the app", () => {
    expect(blocks.length).toBeGreaterThan(30);
  });

  it("hold no menu: menus go in CapAlignedControls", () => {
    const menus = ["<DropdownMenu", "<RowMenu", "{menu(", "{controls}"];
    expect(blocks.filter((b) => menus.some((m) => b.text.includes(m))).map((b) => b.file)).toEqual([]);
  });
});
