import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhonePairGrid } from "@/components/shared/phone-pair-grid";

// SLN-1019: a person's page hid the credits that would sit alone on a last
// row, and each film or perfume's role caption ran into the next row's card
const cards = (n: number) => Array.from({ length: n }, (_, i) => createElement("div", { key: i }, `card ${i}`));

describe("a person's credits", () => {
  it("keep every card, where a dashboard shelf ends on a full row", () => {
    const shelf = renderToStaticMarkup(createElement(PhonePairGrid, { children: cards(7) }));
    expect(shelf).toContain("full-rows");
    expect(shelf).toContain('data-rem-3="1"');
    const record = renderToStaticMarkup(createElement(PhonePairGrid, { endOnFullRow: false, children: cards(7) }));
    expect(record).not.toContain("full-rows");
    expect(record).not.toContain("data-rem-");
    expect(record.match(/card \d/g)).toHaveLength(7);
  });

  it("put the role caption in the card's cell, under a card that fills the rest", () => {
    const page = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/people/[slug]/page.tsx"), "utf8");
    expect(page).toMatch(/<div key=\{id\} className="grid h-full grid-rows-\[1fr_auto\]">\s*<div className="min-h-0">\{card\}<\/div>/);
  });
});
