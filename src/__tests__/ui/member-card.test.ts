// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { readFileSync } from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberCard } from "@/components/collections/member-card";

// A collection's member cards (main audit 2026-10-15): no blank line kept
// under a short title or for a missing fact, and the foot's buttons in two
// groups, Copy and Read on the text's left edge, the collection's controls on
// its right
function render(card: Partial<React.ComponentProps<typeof MemberCard>>) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(MemberCard, {
    href: "/library/the-abyss", image: null, title: "The Abyss", byline: null, facts: null, note: null,
    actions: createElement("button", null, "Remove"), ...card,
  }));
  return host;
}
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("MemberCard", () => {
  it("keeps no blank lines for a short title or missing facts", () => {
    const host = render({});
    expect(host.innerHTML).not.toMatch(/min-h-\[\d?lh\]/);
    expect(host.querySelectorAll("p")).toHaveLength(0);
    // One line is 29px: on touch the title link grows to 44px
    expect(host.querySelector("a.type-item-title")!.className).toContain("touch-hit");
    const full = render({ byline: "Marguerite Yourcenar", facts: "Gallimard · 1968", note: "Book", noteMono: true });
    expect([...full.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Marguerite Yourcenar", "Gallimard · 1968", "Book"]);
    expect(full.querySelectorAll("p")[2].className).toContain("font-mono");
  });

  it("puts the actions in the card's foot, Copy and Read pulled to the text's edge and the controls pushed right", () => {
    const foot = render({}).querySelector("button")!.parentElement!;
    expect(foot.className.split(/\s+/)).toEqual(expect.arrayContaining(["mt-auto", "flex", "flex-wrap"]));
    expect(foot.className).not.toContain("justify-between");
    expect(read("app/(catalogue)/collections/[id]/page.tsx")).toContain('<div className="-ml-1.5 flex items-center gap-1 pointer-coarse:-ml-3.5">');
    expect(read("components/collections/collection-controls.tsx")).toContain('<div className="-mr-2.5 ml-auto flex gap-1 pointer-coarse:-mr-3.5 pointer-coarse:gap-2">');
  });

  it("gives a collection card with no description no blank lines under its name", () => {
    expect(read("components/collections/collection-card.tsx")).toContain("subtitle={collection.description || undefined}");
  });
});
