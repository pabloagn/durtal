import { describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

// SLN-1053: Delete location was a red-painted primary, so plain Enter, which
// presses a dialog's primary, deleted the location and every copy kept there.
// Plain Enter skips a danger button; ⌘Enter still presses it.

const src = path.resolve(__dirname, "../..");
const buttons = (source: string) => source.match(/<Button\b[^>]*>/g) ?? [];

describe("Delete location", () => {
  it("is a danger button that ⌘Enter presses", () => {
    const source = readFileSync(path.join(src, "app/(catalogue)/locations/location-card.tsx"), "utf8");
    const remove = buttons(source).find((button) => button.includes("onClick={handleDelete}"));
    expect(remove).toContain('variant="danger"');
    expect(remove).toContain('data-shortcut="save"');
  });
});

describe("primary buttons", () => {
  it("are never painted red", () => {
    const files = execSync(`grep -rl 'variant="primary"' ${JSON.stringify(src)} --include=*.tsx || true`).toString().trim().split("\n").filter(Boolean);
    const red = files.flatMap((file) =>
      buttons(readFileSync(file, "utf8"))
        .filter((button) => button.includes('variant="primary"') && /accent-red/.test(button))
        .map((button) => `${path.relative(src, file)}: ${button.replace(/\s+/g, " ")}`),
    );
    expect(red).toEqual([]);
  });
});
