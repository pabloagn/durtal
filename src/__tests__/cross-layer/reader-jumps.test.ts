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
    // Resume resolves through an injected adapter. Its concrete startup target
    // is captured and fenced by controller readiness/abort before ready status.
    const resumeCalls: Record<string, string[]> = {
      "lib/ebooks/continue-resolve.ts": [
        "await engine.goTo(resolved.locator);",
        "await engine.goTo({ fraction: anchor.locator.totalProgression });",
      ],
      "app/reader/[ebookId]/reader-view.tsx": ["await openingEngine.goTo(target);"],
    };
    const offenders = files(root).filter((path) => {
      const name = relative(root, path);
      if (
        name.startsWith("__tests__/") ||
        name.startsWith("vendor/") ||
        name.startsWith("lib/reader/engines/") ||
        name === "lib/reader/navigation.ts"
      )
        return false;
      let source = readFileSync(path, "utf8");
      for (const call of resumeCalls[name] ?? []) {
        expect(source.split(call)).toHaveLength(2);
        source = source.replace(call, "");
      }
      return /\.(?:goTo|goToFraction)\s*\(/.test(source);
    });
    expect(offenders).toEqual([]);
    const reader = readFileSync(resolve(root, "app/reader/[ebookId]/reader-view.tsx"), "utf8");
    expect(reader).toContain(`goTo: async (target) => {
                  while (!bridge.isControllerPermitCurrent(admitted)) {
                    admitted = await bridge.whenControllersReady(startupAbort.signal);
                  }
                  if (cancelled || startupAbort.signal.aborted)
                    throw new DOMException("Reader startup cancelled", "AbortError");
                  await openingEngine.goTo(target);`);
  });
});
