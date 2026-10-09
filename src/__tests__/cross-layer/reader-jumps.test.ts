import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
const root = resolve("src");
const files = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : /\.(?:ts|tsx|js)$/.test(path)
        ? [path]
        : [];
  });
describe("reader jump ownership", () => {
  it("keeps every application jump behind the session controller", () => {
    const offenders = files(root).filter((path) => {
      const name = relative(root, path);
      if (
        name.startsWith("__tests__/") ||
        name.startsWith("vendor/") ||
        name.startsWith("lib/reader/engines/") ||
        name === "lib/reader/navigation.ts"
      )
        return false;
      return /\.(?:goTo|goToFraction)\s*\(/.test(readFileSync(path, "utf8"));
    });
    expect(offenders).toEqual([]);
  });
});
