import { describe, expect, it } from "vitest";
import { READER_KEYMAP, shortcutRows } from "@/lib/reader/keymap";
import { keyLabel } from "@/lib/shortcuts/shortcuts";

describe("the reader's shortcut sheet", () => {
  it("prints every reader key as a key cap, never as its event name", () => {
    const printed = READER_KEYMAP.flatMap((item) => item.key.split(" ")).map((token) => keyLabel(token, false));
    for (const label of printed) expect(label).not.toMatch(/^(ARROW|PAGE(UP|DOWN)|SPACE|ESCAPE|HOME|END)/);
    expect(["arrowleft", "arrowright", "space", "pageup", "pagedown", "home", "end", "escape"].map((key) => keyLabel(key, false)))
      .toEqual(["←", "→", "Space", "Page Up", "Page Down", "Home", "End", "Esc"]);
    expect(["alt", "arrowleft"].map((key) => keyLabel(key, true))).toEqual(["⌥", "←"]);
  });

  it("lists an action once, with each of its shortcuts", () => {
    const rows = shortcutRows(READER_KEYMAP);
    const turning = rows.filter((row) => row.group === "Turning pages");
    expect(turning.map((row) => row.label)).toEqual(["Turn right", "Turn left", "Next page", "Previous page", "First page", "Last page"]);
    expect(turning.find((row) => row.label === "Previous page")?.keys).toEqual([["shift", "space"], ["pageup"]]);
    // The same key in another context is another row
    expect(rows.filter((row) => row.label === "Highlight colour 1")).toHaveLength(1);
    expect(rows.find((row) => row.group === "Scrubber" && row.label === "Cancel preview")?.keys).toEqual([["escape"]]);
  });
});
