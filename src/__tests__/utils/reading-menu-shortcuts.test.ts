import { describe, expect, it } from "vitest";
import { READING_KEYS, SHORTCUTS, SHORTCUT_GROUPS } from "@/lib/shortcuts/shortcuts";

describe("Reading menu shortcuts (SLN-447)", () => {
  it("opens with R, apart from the other menus", () => {
    expect(SHORTCUTS.readingMenu).toEqual(["r"]);
    const menus = [SHORTCUTS.addMenu, SHORTCUTS.goMenu, SHORTCUTS.copyMenu, SHORTCUTS.editMenu];
    expect(menus.map((m) => m[0])).not.toContain("r");
  });

  it("gives each reading action its own key", () => {
    expect(READING_KEYS).toEqual({ start: "s", progress: "p", pause: "u", finish: "f", abandon: "a", past: "l", history: "h", timer: "t" });
    const keys = Object.values(READING_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lists R and its keys in the shortcuts sheet", () => {
    const menus = SHORTCUT_GROUPS.find((g) => g.title === "Menus");
    expect(menus?.items.some((i) => i.keys.join() === "r")).toBe(true);
    const reading = SHORTCUT_GROUPS.find((g) => g.title === "Reading");
    expect(reading?.items.map((i) => i.keys.join(" "))).toEqual(["r s", "r p", "r u", "r f", "r a", "r l", "r t", "r h"]);
  });
});
