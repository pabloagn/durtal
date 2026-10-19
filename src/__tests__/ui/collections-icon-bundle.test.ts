import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-1105: /collections' client view imported the card, and the card the
// whole Lucide icon set (about 134 KB gz) to draw one icon. The card now
// takes its icon drawn on the server, so the set stays out of client code.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("a collection card's icon", () => {
  it("comes in as a node: the card never imports the icon set", () => {
    const card = read("components/collections/collection-card.tsx");
    expect(card).not.toContain("collection-icon");
    expect(card).not.toMatch(/from "lucide-react"/);
    expect(card).toContain("icon={icon || undefined}");
  });

  it("is drawn on the server by every caller", () => {
    for (const file of [
      "app/(catalogue)/page.tsx",
      "app/(catalogue)/collections/page.tsx",
      "components/collections/work-collections.tsx",
    ])
      expect(read(file), file).toContain("collectionCardIcon(collection.icon)");
    expect(read("components/collections/collections-view.tsx")).toContain("icon={icon} />");
  });
});
