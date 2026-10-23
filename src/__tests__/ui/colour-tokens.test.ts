import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

const root = join(process.cwd(), "src");
const css = readFileSync(join(root, "styles/globals.css"), "utf8");
const tokens = new Set([...css.matchAll(/--color-([\w-]+)\s*:/g)].map((match) => match[1]));
// Limit this to the app's colour namespaces, not Tailwind sizes (border-2),
// arbitrary values, or built-ins such as transparent/current.
function unknownColours(source: string): string[] {
  const utilities = source.matchAll(/\b(?:bg|text|border|outline|ring|divide|decoration|fill|stroke)-((?:bg|fg|accent|glass|border|action|selection|scrim|overlay)(?:-[a-z]+)+)/g);
  return [...utilities].map((match) => match[1]).filter((name) => !tokens.has(name));
}
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(path);
    return /\.(?:tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

it("rejects the reader's old missing border colour, including focus variants", () => {
  expect(unknownColours("border-border-primary focus:border-border-primary")).toEqual(["border-primary", "border-primary"]);
  expect(unknownColours("border-border-control placeholder:text-fg-muted outline-accent-primary border-2 border-transparent")).toEqual([]);
});

it("uses declared app colour tokens in source utilities", () => {
  const unknown = sources(root).flatMap((path) => unknownColours(readFileSync(path, "utf8"))
    .map((name) => `${relative(root, path)}: ${name}`));
  expect(unknown).toEqual([]);
});
