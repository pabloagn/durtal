import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { READER_KEYMAP } from "@/lib/reader/keymap";
import { READER_PAGE_RE } from "@/lib/reader/csp";
const sources = (path: string): string[] =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "vendor") return [];
    const full = resolve(path, entry.name);
    return entry.isDirectory()
      ? sources(full)
      : /\.(?:ts|tsx)$/.test(full)
        ? [full]
        : [];
  });
describe("epic key ownership", () => {
  it("defines each key once in its context and leaves global browser shortcuts free", () => {
    const keys = READER_KEYMAP.map((item) => item.context + ":" + item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      READER_KEYMAP.some((item) =>
        ["mod k", "meta k", "ctrl k", "alt f"].includes(item.key),
      ),
    ).toBe(false);
    expect(
      READER_PAGE_RE.test("/reader/00000000-0000-4000-a000-000000000019"),
    ).toBe(true);
  });
  it("requires literal registered reader keys to belong to the epic map", () => {
    const registered = sources(resolve("src")).flatMap((path) =>
      [
        ...readFileSync(path, "utf8").matchAll(
          /useReaderShortcut\(\s*["']([^"']+)["']/g,
        ),
      ].map((match) => match[1].toLowerCase()),
    );
    expect(registered.length).toBeGreaterThan(0);
    expect(
      registered.filter(
        (key) => !READER_KEYMAP.some((item) => item.key === key),
      ),
    ).toEqual([]);
  });
});
