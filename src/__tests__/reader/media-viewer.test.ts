// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { clampZoom, fitScale, zoomAt } from "@/lib/reader/media/zoom";
import {
  sanitizedSvg,
  viewerImage,
  tableForViewer,
} from "@/lib/reader/media/content";
describe("content viewer policies", () => {
  it("centres smaller axes, clamps larger axes and limits zoom to eight times fit", () => {
    const size = {
      width: 1000,
      height: 800,
      contentWidth: 2000,
      contentHeight: 500,
    };
    expect(fitScale(size)).toBe(0.45);
    expect(clampZoom({ scale: 1, x: 9999, y: 9999 }, size)).toEqual({
      scale: 1,
      x: 500,
      y: 0,
    });
    expect(clampZoom({ scale: 99, x: 0, y: 0 }, size).scale).toBe(3.6);
    expect(
      zoomAt(
        { scale: 1, x: 0, y: 0 },
        { ...size, contentHeight: 2000 },
        2,
        100,
        100,
      ),
    ).toEqual({ scale: 2, x: -100, y: -100 });
  });
  it("selects only unlinked images at least 64px in both dimensions", () => {
    const image = document.createElement("img");
    image.getBoundingClientRect = () => ({ width: 64, height: 64 }) as DOMRect;
    document.body.append(image);
    expect(viewerImage(image)).toBe(image);
    const a = document.createElement("a");
    a.href = "#one";
    a.append(image);
    expect(viewerImage(image)).toBeNull();
    a.replaceWith(image);
    image.getBoundingClientRect = () => ({ width: 63, height: 200 }) as DOMRect;
    expect(viewerImage(image)).toBeNull();
  });
  it("removes SVG executable content, event handlers and external resource references", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [name, attributes] of [
      ["script", {}],
      ["foreignObject", {}],
      [
        "path",
        {
          onclick: "evil()",
          fill: "url(https://evil.invalid/image)",
          d: "M0 0",
        },
      ],
      ["use", { href: "#safe" }],
      ["image", { href: "javascript:evil()" }],
    ] as const) {
      const child = document.createElementNS(svg.namespaceURI, name);
      for (const [key, value] of Object.entries(attributes))
        child.setAttribute(key, value);
      svg.append(child);
    }
    const clean = sanitizedSvg(svg);
    expect(
      clean.querySelector("script,foreignObject,[onclick],[fill]"),
    ).toBeNull();
    expect(clean.querySelector("use")?.getAttribute("href")).toBe("#safe");
    expect(clean.querySelector("image")?.hasAttribute("href")).toBe(false);
    expect(svg.querySelector("script")).not.toBeNull();
  });
  it("keeps table semantics and publisher classes without executable attributes", () => {
    const table = document.createElement("table");
    table.className = "wide";
    table.innerHTML =
      '<tr><th scope="col" onclick="evil()">A</th><td colspan="2">B</td></tr>';
    const clean = tableForViewer(table, document);
    expect(clean.className).toBe("wide");
    expect(clean.querySelector("th")?.getAttribute("scope")).toBe("col");
    expect(clean.querySelector("[onclick]")).toBeNull();
  });
});
