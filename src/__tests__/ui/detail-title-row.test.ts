// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { readFileSync } from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailControls, DetailEditButton, DetailTitleRow } from "@/components/shared/detail-layout";

// A detail page's title on a phone takes the row's width, its controls going
// under it, decided by a container query alone (SLN-641, from #260). The
// browser layout is measured by hand; this pins the classes it rests on.
function render(controls?: "standard" | "wide" | "stacked" | "free") {
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
      ["app/(catalogue)/people/[slug]/author-detail-header.tsx", '<DetailTitleRow title={name} controls="wide">'],
      ["app/(catalogue)/series/[id]/page.tsx", '<DetailTitleRow title={s.title} controls="free">'],
      ["app/(catalogue)/films/[slug]/page.tsx", '<DetailTitleRow title={film.title} controls="stacked">'],
      ["app/(catalogue)/paintings/[slug]/page.tsx", '<DetailTitleRow title={painting.title} controls="wide">'],
      ["app/(catalogue)/perfumes/[slug]/page.tsx", '<DetailTitleRow title={perfume.title} controls="wide">'],
      ["app/(catalogue)/organizations/[slug]/page.tsx", '<DetailTitleRow title={organization.name} controls="wide">'],
      ["app/(catalogue)/places/[slug]/page.tsx", '<DetailTitleRow title={venue.name} controls="wide">'],
    ];
    for (const [file, row] of pages) expect(read(file), file).toContain(row);
    for (const file of ["films/film-actions", "paintings/painting-actions", "perfumes/perfume-actions", "organizations/organization-actions"])
      expect(read(`components/${file}.tsx`), file).toContain("<DetailControls>");
    expect(read("app/(catalogue)/places/[slug]/venue-actions.tsx")).toContain("<DetailControls>");
  });

  // One visible set on every kind but the book: the favourite, a labelled
  // Edit and the Actions menu, Export in the menu (SLN-641 piece 3)
  it("gives every kind but the book the favourite, Edit and the menu", () => {
    const sets: [string, string][] = [
      ["components/publishers/publisher-header.tsx", '<DetailEditButton label="Edit publisher" editKey={EDIT_KEYS.publisher}'],
      ["app/(catalogue)/people/[slug]/author-detail-header.tsx", '<DetailEditButton label="Edit person" editKey={EDIT_KEYS.person}'],
      ["components/films/film-actions.tsx", '<DetailEditButton label="Edit film" editKey={EDIT_KEYS.work}'],
      ["components/paintings/painting-actions.tsx", '<DetailEditButton label="Edit painting" editKey={EDIT_KEYS.work}'],
      ["components/perfumes/perfume-actions.tsx", '<DetailEditButton label="Edit perfume" editKey={EDIT_KEYS.work}'],
      ["components/organizations/organization-actions.tsx", '<DetailEditButton label="Edit organization" editKey={EDIT_KEYS.organization}'],
      ["app/(catalogue)/places/[slug]/venue-actions.tsx", '<DetailEditButton label="Edit place" editKey={EDIT_KEYS.place}'],
    ];
    for (const [file, edit] of sets) {
      const source = read(file);
      expect(source, file).toContain(edit);
      // Edit sits between the favourite (passed in, or first) and the menu
      expect(source.indexOf("<DetailEditButton"), file).toBeLessThan(source.indexOf("<EntityActionMenu"));
      expect(source, file).not.toContain("<ExportMenu");
    }
    expect(read("app/(catalogue)/people/[slug]/author-detail-header.tsx")).toContain('...exportActionItems("authors", [authorId], "person")');
    expect(read("app/(catalogue)/organizations/[slug]/page.tsx")).toContain('target={{ entity: "organization", id }}');
  });

  it("labels Edit, names the item and its keys in the tooltip", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(DetailEditButton, { label: "Edit film", editKey: "w", onClick: () => {} }));
    const button = host.querySelector("button")!;
    expect(button.textContent).toBe("Edit");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.dataset.tooltip).toBe("Edit film");
    expect(button.dataset.tooltipKeys).toBe("e then w");
    expect(classes(button)).toEqual(expect.arrayContaining(["h-8", "pointer-coarse:h-11"]));
    host.innerHTML = renderToStaticMarkup(createElement(DetailEditButton, { label: "Edit publisher", editKey: "p", href: "/publishers/gallimard/edit" }));
    expect(host.querySelector("a")!.getAttribute("href")).toBe("/publishers/gallimard/edit");
  });
});

// On a phone a long title steps down the scale (SLN-641, main audit 10):
// the attribute globals.css sizes it by, on the h1 and the row its controls
// take their line from
describe("DetailTitleRow's long titles", () => {
  const rowOf = (title: string) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(DetailTitleRow, { title, children: null }));
    return { row: host.firstElementChild!.firstElementChild!, h1: host.querySelector("h1")! };
  };
  it("marks a title past 40 letters long and past 60 longer", () => {
    expect(rowOf("x".repeat(40)).h1.getAttribute("data-title-length")).toBeNull();
    for (const [length, mark] of [[41, "long"], [60, "long"], [61, "longer"]] as const) {
      const { row, h1 } = rowOf("x".repeat(length));
      expect(h1.getAttribute("data-title-length")).toBe(mark);
      expect(row.getAttribute("data-title-length")).toBe(mark);
    }
    const css = read("styles/globals.css");
    expect(css).toMatch(/@media \(max-width: 639px\) \{\s*\.type-page-title\[data-title-length="long"\] \{\s*font-size: var\(--text-3xl\);/);
    expect(css).toContain('.type-page-title[data-title-length="longer"] {\n    font-size: var(--text-2xl);');
  });
});
