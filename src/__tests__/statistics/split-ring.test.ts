// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SplitRing } from "@/components/statistics/split-ring";

/* A split ring is named once, with its share, and reads nothing twice (SLN-1172) */
describe("split ring", () => {
  it("names the figure with the share and hides the drawing and the legend", () => {
    const html = renderToStaticMarkup(
      createElement(SplitRing, { title: "Read", first: { label: "Read", value: 2151 }, second: { label: "Not finished", value: 2016 } }),
    );
    const host = new DOMParser().parseFromString(html, "text/html").body;
    const figure = host.querySelector("figure")!;
    expect(figure.getAttribute("aria-label")).toBe("Read: 52%, 2,151 of 4,167");
    expect([...figure.children].map((child) => child.getAttribute("aria-hidden"))).toEqual(["true", "true"]);
    // Still on the page for sight: the share, the title and both parts
    expect(figure.textContent).toBe("52%ReadRead 2,151Not finished 2,016");
  });
});
