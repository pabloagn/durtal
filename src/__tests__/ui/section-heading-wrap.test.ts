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
