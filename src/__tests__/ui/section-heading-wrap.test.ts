// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionHeading } from "@/components/shared/section-heading";

// A place page's "Institution" beside "Link an institution" on a 320px phone:
// the title column was squeezed to 104px, so the 123px word broke mid-word.
// The browser layout is measured by hand; this pins the classes it rests on.
it("wraps the action under the title instead of breaking a plain word", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(SectionHeading, {
    title: "Institution", action: createElement("button", null, "Link an institution") }));
  const row = host.firstElementChild!;
  const column = row.firstElementChild!;
  const heading = host.querySelector("h2")!;
  expect(row.className.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-wrap"]));
  // The column's narrowest width is its longest word, and it fills the line
  expect(column.className.split(" ")).toEqual(expect.arrayContaining(["w-min", "min-w-0", "grow"]));
  // Wrapped under the title, the action keeps to the right edge
  expect(column.nextElementSibling!.className.split(" ")).toContain("ml-auto");
  // anywhere would make that narrowest width one letter, so nothing would wrap
  expect(heading.className).toContain("[overflow-wrap:break-word]");
  expect(heading.className).not.toContain("anywhere");
});

// A perfume's "Formulations (3)" beside "Add formulation" at 390: "(3)" wrapped
// to a line of its own. Bound to the last word, the count makes the title's
// narrowest width "Formulations (3)", so the action wraps under it (SLN-835).
it("keeps the count with the title's last word", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(SectionHeading, {
    title: "Formulations", count: 3, action: createElement("button", null, "Add formulation") }));
  const heading = host.querySelector("h2")!;
  expect(heading.textContent).toBe("Formulations (3)");
  expect(heading.querySelector("span")!.className.split(" ")).toContain("whitespace-nowrap");
});

// "Not in Durtal (1107)": a count groups its thousands, as every other count
// does (SLN-827)
it("groups the thousands of its count", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(SectionHeading, { title: "Not in Durtal", count: 1107 }));
  expect(host.querySelector("h2")!.textContent).toBe("Not in Durtal (1,107)");
  host.innerHTML = renderToStaticMarkup(createElement(SectionHeading, { title: "Books", count: 0 }));
  expect(host.querySelector("h2")!.textContent).toBe("Books (0)");
});
