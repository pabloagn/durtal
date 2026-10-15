// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { readFileSync } from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { FactsRow } from "@/components/shared/facts-row";

// A facts row's separator never starts a line (SLN-641). The browser layout
// is measured by hand; this pins the classes the clipping rests on.
function render(facts: string[]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(FactsRow, { facts, className: "mt-3" }));
  return host;
}
const classes = (el: Element) => el.className.split(/\s+/);

describe("FactsRow", () => {
  it("renders nothing without facts", () => {
    expect(render([]).innerHTML).toBe("");
  });

  it("clips the separator of a fact that starts a line", () => {
    const row = render(["Imprint of Penguin Books", "United Kingdom", "Founded 1961"]).firstElementChild!;
    expect(classes(row)).toEqual(
      expect.arrayContaining(["-ml-5", "flex", "flex-wrap", "[clip-path:inset(-0.5rem_-0.5rem_-0.5rem_1rem)]", "mt-3"]),
    );
    const items = [...row.children];
    expect(items.map((item) => item.textContent)).toEqual(["·Imprint of Penguin Books", "·United Kingdom", "·Founded 1961"]);
    for (const item of items) {
      expect(classes(item)).toEqual(expect.arrayContaining(["relative", "ml-5"]));
      const sep = item.firstElementChild!;
      expect(sep.getAttribute("aria-hidden")).toBe("true");
      expect(classes(sep)).toEqual(expect.arrayContaining(["absolute", "right-full", "w-5"]));
    }
  });

  it("is the publisher header's facts row; the painting's whereabouts keep a separator to the word before", () => {
    const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    expect(read("components/publishers/publisher-header.tsx")).toContain("<FactsRow facts={facts}");
    const painting = read("app/(catalogue)/paintings/[slug]/page.tsx");
    expect(painting).toContain('{"\\u00a0· "}{now.custody}');
    expect(painting).toContain('.join("\\u00a0· ")');
    expect(painting).not.toMatch(/[^ ]· \{now\./);
  });
});
