import { describe, expect, it } from "vitest";
import { EDIT_KEYS, SHORTCUTS, SHORTCUT_GROUPS } from "@/lib/shortcuts/shortcuts";

describe("Edit menu shortcuts (SLN-421)", () => {
  it("opens with E, apart from the other menus", () => {
    expect(SHORTCUTS.editMenu).toEqual(["e"]);
    const menus = [SHORTCUTS.addMenu, SHORTCUTS.goMenu, SHORTCUTS.copyMenu];
    expect(menus.map((m) => m[0])).not.toContain("e");
  });

  it("gives work, media and taxonomy one key each", () => {
    expect(EDIT_KEYS).toEqual({ work: "w", media: "m", taxonomy: "t" });
    const keys = Object.values(EDIT_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lists E then W, M and T in the shortcuts sheet", () => {
    const menus = SHORTCUT_GROUPS.find((g) => g.title === "Menus");
    expect(menus?.items.some((i) => i.keys.join() === "e")).toBe(true);
    const edit = SHORTCUT_GROUPS.find((g) => g.title === "Edit");
    expect(edit?.items.map((i) => [i.keys.join(" "), i.then])).toEqual([
      ["e w", true],
      ["e m", true],
      ["e t", true],
    ]);
  });
});
