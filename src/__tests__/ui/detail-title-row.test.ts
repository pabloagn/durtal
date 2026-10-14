// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { readFileSync } from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailControls, DetailTitleRow } from "@/components/shared/detail-layout";

// A detail page's title on a phone takes the row's width, its controls going
// under it, decided by a container query alone (SLN-641, from #260). The
// browser layout is measured by hand; this pins the classes it rests on.
function render(controls?: "icons" | "standard" | "wide" | "stacked" | "free") {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(DetailTitleRow, {
    title: "Ada or Ardor: A Family Chronicle",
    controls,
    children: createElement(DetailControls, { children: createElement("button", null, "Star") }),
  }));
  const container = host.firstElementChild!;
  const row = container.firstElementChild!;
  return { container, row, h1: host.querySelector("h1")!, controls: host.querySelector("h1")!.nextElementSibling! };
}
const classes = (el: Element) => el.className.split(/\s+/);
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("DetailTitleRow", () => {
  it("wraps the controls under the title only in a narrow row", () => {
    const { container, row, h1, controls } = render();
    expect(classes(container)).toContain("@container");
    expect(classes(row)).toEqual(expect.arrayContaining(["flex", "flex-wrap", "@min-[24rem]:flex-nowrap"]));
    // The title fills its line, so wrapped it takes the row's width
    expect(classes(h1)).toEqual(expect.arrayContaining(["min-w-0", "flex-[1_1_auto]", "break-words"]));
    // Under the title the star's padding is pulled out, so its icon lines up with the title
    expect(classes(controls)).toEqual(expect.arrayContaining(["-ml-2", "pointer-coarse:-ml-3.5"]));
  });

  it("wraps by the controls' width and each kind's free wrapping, 12px from the title but on the publisher page", () => {
    expect(classes(render("icons").row)).toEqual(expect.arrayContaining(["gap-x-5", "pointer-coarse:gap-x-6.5", "@min-[14rem]:flex-nowrap"]));
    const wide = classes(render("wide").row);
    expect(wide).toEqual(expect.arrayContaining([
      "gap-x-5", "pointer-coarse:gap-x-6.5",
      // A screen with neither mouse nor touch takes the mouse's width
      "not-pointer-coarse:@min-[33rem]:flex-nowrap", "pointer-coarse:@min-[39rem]:flex-nowrap"]));
    expect(wide).not.toContain("@min-[24rem]:flex-nowrap");
    expect(classes(render("stacked").row)).toContain("sm:flex-nowrap");
    expect(classes(render("free").row).filter((c) => c.endsWith("flex-nowrap"))).toEqual([]);
  });

  it("is the header row of every detail kind", () => {
    const pages: [string, string][] = [
      ["app/(catalogue)/library/[slug]/page.tsx", '<DetailTitleRow title={work.title} controls="wide">'],
      ["components/publishers/publisher-header.tsx", "<DetailTitleRow title={name}>"],
      ["app/(catalogue)/people/[slug]/author-detail-header.tsx", '<DetailTitleRow title={name} controls="free">'],
      ["app/(catalogue)/series/[id]/page.tsx", '<DetailTitleRow title={s.title} controls="free">'],
      ["app/(catalogue)/films/[slug]/page.tsx", '<DetailTitleRow title={film.title} controls="stacked">'],
      ["app/(catalogue)/paintings/[slug]/page.tsx", '<DetailTitleRow title={painting.title} controls="stacked">'],
      ["app/(catalogue)/perfumes/[slug]/page.tsx", '<DetailTitleRow title={perfume.title} controls="stacked">'],
      ["app/(catalogue)/organizations/[slug]/page.tsx", '<DetailTitleRow title={organization.name} controls="icons">'],
      ["app/(catalogue)/places/[slug]/page.tsx", '<DetailTitleRow title={venue.name} controls="icons">'],
    ];
    for (const [file, row] of pages) expect(read(file), file).toContain(row);
    for (const file of ["films/film-actions", "paintings/painting-actions", "perfumes/perfume-actions", "organizations/organization-actions"])
      expect(read(`components/${file}.tsx`), file).toContain("<DetailControls>");
    expect(read("app/(catalogue)/places/[slug]/venue-actions.tsx")).toContain("<DetailControls>");
  });
});
