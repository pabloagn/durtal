import { describe, expect, it } from "vitest";
import { EDIT_KEYS, SHORTCUTS, SHORTCUT_GROUPS } from "@/lib/shortcuts/shortcuts";

describe("Edit menu shortcuts (SLN-421)", () => {
  it("opens with E, apart from the other menus", () => {
    expect(SHORTCUTS.editMenu).toEqual(["e"]);
    const menus = [SHORTCUTS.newMenu, SHORTCUTS.goMenu, SHORTCUTS.copyMenu];
    expect(menus.map((m) => m[0])).not.toContain("e");
  });

  it("gives each action on one page its own key (SLN-633)", () => {
    expect(EDIT_KEYS).toMatchObject({ work: "w", media: "m", taxonomy: "t", collection: "c" });
    // The letters a page can show together; P is a person, publisher or
    // place, which never share a page
    for (const page of [
      [EDIT_KEYS.work, EDIT_KEYS.media, EDIT_KEYS.taxonomy],
      [EDIT_KEYS.collection, EDIT_KEYS.media],
      [EDIT_KEYS.person, EDIT_KEYS.media],
      [EDIT_KEYS.publisher, EDIT_KEYS.media],
    ])
      expect(new Set(page).size).toBe(page.length);
  });

  it("lists E then each letter in the shortcuts sheet", () => {
    const menus = SHORTCUT_GROUPS.find((g) => g.title === "Menus");
    expect(menus?.items.some((i) => i.keys.join() === "e")).toBe(true);
    const edit = SHORTCUT_GROUPS.find((g) => g.title === "Edit");
    expect(edit?.items.map((i) => [i.keys.join(" "), i.then])).toEqual(
      ["w", "m", "t", "c", "p", "o", "s", "r"].map((k) => [`e ${k}`, true]),
    );
  });
});
