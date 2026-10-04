import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

// The glass material is a ::before layer (globals.css, `glass`). On an element
// that scrolls, the layer scrolls away with the first screenful and the rest
// of the list sits on the bare page. A glass surface takes overflow-hidden and
// an element inside it scrolls.

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "__tests__" || name === "node_modules") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/** Every static className on a JSX element, with its tag. */
function classNames(source: string): { tag: string; classes: string[] }[] {
  const found: { tag: string; classes: string[] }[] = [];
  const attribute = /\bclassName=(?:"([^"]*)"|\{`([^`]*)`\})/g;
  for (const match of source.matchAll(attribute)) {
    // The element is the last tag opened before the attribute
    const before = source.slice(0, match.index);
    const tags = [...before.matchAll(/<([a-zA-Z][\w.]*)\s/g)];
    const value = (match[1] ?? match[2]).replace(/\$\{[^}]*\}/g, " ");
    found.push({
      tag: tags.at(-1)?.[1] ?? "",
      classes: value.split(/\s+/).filter(Boolean),
    });
  }
  return found;
}

const SCROLLS = /^(?:[a-z-]+:)*overflow(?:-[xy])?-(?:auto|scroll)$/;

const glassElements = sourceFiles(SRC).flatMap((file) =>
  classNames(readFileSync(file, "utf8"))
    .filter(({ classes }) => classes.includes("glass") || classes.includes("glass-bar"))
    .map((element) => ({ file: path.relative(SRC, file), ...element })),
);

describe("glass surfaces", () => {
  it("finds the glass surfaces", () => {
    expect(glassElements.length).toBeGreaterThan(10);
  });

  it("never scroll themselves", () => {
    const scrolling = glassElements
      .filter(({ classes }) => classes.some((c) => SCROLLS.test(c)))
      .map(({ file, tag }) => `${file} <${tag}>`);
    expect(scrolling).toEqual([]);
  });

  it("clip a native dialog, which scrolls by default", () => {
    const dialogs = glassElements.filter(({ tag }) => tag === "dialog");
    expect(dialogs.length).toBeGreaterThan(0);
    for (const { classes } of dialogs) expect(classes).toContain("overflow-hidden");
  });
});
