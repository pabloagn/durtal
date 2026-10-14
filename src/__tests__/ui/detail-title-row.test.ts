// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { readFileSync } from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailTitleRow } from "@/components/shared/detail-layout";

// A detail page's title on a phone takes the row's width, its controls going
// under it, decided by a container query alone (SLN-641, from #260). The
// browser layout is measured by hand; this pins the classes it rests on.
function render(wideControls: boolean) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(DetailTitleRow,
    { title: "Ada or Ardor: A Family Chronicle", wideControls, children: createElement("button", null, "Star") }));
  const container = host.firstElementChild!;
  const row = container.firstElementChild!;
  return { container, row, h1: host.querySelector("h1")!, controls: host.querySelector("h1")!.nextElementSibling! };
}
const classes = (el: Element) => el.className.split(/\s+/);

describe("DetailTitleRow", () => {
  it("wraps the controls under the title only in a narrow row", () => {
    const { container, row, h1, controls } = render(false);
    expect(classes(container)).toContain("@container");
    expect(classes(row)).toEqual(expect.arrayContaining(["flex", "flex-wrap", "@min-[24rem]:flex-nowrap"]));
    // The title fills its line, so wrapped it takes the row's width
    expect(classes(h1)).toEqual(expect.arrayContaining(["min-w-0", "flex-[1_1_auto]", "break-words"]));
    // Under the title the star's padding is pulled out, so its icon lines up with the title
    expect(classes(controls)).toEqual(expect.arrayContaining(["-ml-2", "pointer-coarse:-ml-3.5"]));
  });

  it("gives the book's wider controls a wider narrow row and their 12px gap", () => {
    const { row } = render(true);
    expect(classes(row)).toEqual(expect.arrayContaining([
      "gap-x-5", "pointer-coarse:gap-x-6.5",
      "pointer-fine:@min-[33rem]:flex-nowrap", "pointer-coarse:@min-[39rem]:flex-nowrap"]));
    expect(classes(row)).not.toContain("@min-[24rem]:flex-nowrap");
  });

  it("is the header row of the book and publisher pages", () => {
    const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    expect(read("app/(catalogue)/library/[slug]/page.tsx")).toContain("<DetailTitleRow title={work.title} wideControls>");
    expect(read("components/publishers/publisher-header.tsx")).toContain("<DetailTitleRow title={name}>");
  });
});
