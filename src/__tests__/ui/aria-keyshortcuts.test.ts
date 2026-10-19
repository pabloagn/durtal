import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { ariaKeyShortcuts, shortcutProps } from "@/lib/shortcuts/shortcuts";

// SLN-964: the shortcut keys showed only in tooltips and key caps, which
// assistive technology does not read as shortcuts.

describe("ariaKeyShortcuts", () => {
  it("gives a leader sequence none, since a space means another shortcut", () => {
    expect(ariaKeyShortcuts("e then w", true)).toBeUndefined();
    expect(ariaKeyShortcuts("a then l", false)).toBeUndefined();
  });

  it("writes a modifier key for the platform", () => {
    expect(ariaKeyShortcuts("mod k", true)).toBe("Meta+K");
    expect(ariaKeyShortcuts("mod k", false)).toBe("Control+K");
    expect(ariaKeyShortcuts("mod enter", false)).toBe("Control+Enter");
    expect(ariaKeyShortcuts("alt left", true)).toBe("Alt+ArrowLeft");
    expect(ariaKeyShortcuts("alt f", false)).toBe("Alt+F");
  });

  it("names keys as aria-keyshortcuts does", () => {
    expect(ariaKeyShortcuts("esc", true)).toBe("Escape");
    expect(ariaKeyShortcuts("escape", true)).toBe("Escape");
    expect(ariaKeyShortcuts("←", true)).toBe("ArrowLeft");
    expect(ariaKeyShortcuts("+", true)).toBe("Plus");
    expect(ariaKeyShortcuts("-", true)).toBe("-");
    expect(ariaKeyShortcuts("3", true)).toBe("3");
  });
});

describe("shortcutProps", () => {
  it("gives the tooltip's keys and the same keys for assistive technology", () => {
    expect(shortcutProps("alt f")).toEqual({ "data-tooltip-keys": "alt f", "aria-keyshortcuts": "Alt+F" });
    expect(shortcutProps("g then b")).toEqual({ "data-tooltip-keys": "g then b" });
    expect(shortcutProps("mod k", false)).toEqual({ "data-tooltip-keys": "mod k", "aria-keyshortcuts": "Control+K" });
  });

  it("gives nothing for no shortcut", () => {
    expect(shortcutProps(undefined)).toEqual({});
  });
});

const files = (pattern: string) =>
  execSync(`grep -rlE '${pattern}' src --include=*.tsx || true`, { encoding: "utf8" }).split("\n").filter(Boolean);

describe("every control with a tooltip shortcut", () => {
  it("sets it through shortcutProps", () => {
    const bare = files("data-tooltip-keys(=|\": )").filter((file) => !file.startsWith("src/__tests__/"));
    expect(bare).toEqual([]);
  });

  it("passes the platform where the shortcut has mod", () => {
    for (const file of files('shortcutProps\\("mod ')) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/shortcutProps\("mod [^"]*"\)/);
      expect(source, file).toContain("useIsMac()");
    }
  });

  it("includes the page search that / focuses", () => {
    for (const file of files("data-shortcut-search=")) {
      expect(readFileSync(file, "utf8"), file).toMatch(/data-shortcut-search=""\s+aria-keyshortcuts="\/"/);
    }
  });
});
