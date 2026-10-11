// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { pageMarkerPhysicallyVisible } from "./page-marker-visibility";

afterEach(() => document.body.replaceChildren());
function scene() {
  const renderer = document.createElement("div"), frame = document.createElement("iframe");
  renderer.style.overflowX = "hidden"; renderer.style.overflowY = "hidden";
  renderer.append(frame); document.body.append(renderer);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = '<p>Before</p><span id="page-57"></span><p>After</p>';
  Object.defineProperty(doc.defaultView!, "frameElement", { configurable: true, value: frame });
  Object.defineProperty(doc.defaultView!, "innerWidth", { configurable: true, value: 43362 });
  Object.defineProperty(doc.defaultView!, "innerHeight", { configurable: true, value: 900 });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  const setBox = (el: HTMLElement, x: number, y: number, width: number, height: number) => {
    for (const [key, value] of Object.entries({ offsetWidth: width, clientWidth: width, offsetHeight: height, clientHeight: height }))
      Object.defineProperty(el, key, { configurable: true, value });
    el.getBoundingClientRect = () => new DOMRect(x, y, width, height);
  };
  setBox(frame, -18990, 0, 43362, 900); setBox(renderer, 63, 0, 1314, 900);
  const marker = doc.getElementById("page-57")!;
  marker.getClientRects = () => [new DOMRect(19750, 777.5625, 0, 0)] as unknown as DOMRectList;
  return { renderer, frame, doc, marker, setBox };
}
it("accepts the actual measured zero-area pagebreak point through translated iframe clipping", () => {
  const s = scene();
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(true);
});
it("rejects rectless and hidden markers even when native DOM range contains them", () => {
  const s = scene(), range = s.doc.createRange(); range.selectNodeContents(s.doc.body);
  expect(range.comparePoint(s.marker, 0)).toBe(0);
  s.marker.getClientRects = () => [] as unknown as DOMRectList;
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
  s.marker.getClientRects = () => [new DOMRect(19750, 777.5625, 0, 0)] as unknown as DOMRectList;
  for (const style of ["display:none", "visibility:hidden", "opacity:0"]) {
    s.marker.setAttribute("style", style);
    expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
  }
});
it("rejects points outside the actual clipped container or document cross-axis", () => {
  const s = scene();
  s.marker.getClientRects = () => [new DOMRect(20407, 412, 0, 0)] as unknown as DOMRectList;
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false); // Chromium58 lies past1377px.
  s.marker.getClientRects = () => [new DOMRect(19750, 1000, 0, 0)] as unknown as DOMRectList;
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
});
it("fails safely for rotated, masked, nested-clipped, detached and different frames", () => {
  const s = scene();
  for (const style of ["overflow-x:hidden;overflow-y:hidden;transform:rotate(90deg)", "overflow-x:hidden;overflow-y:hidden;clip-path:circle(1px)"]) {
    s.renderer.setAttribute("style", style);
    expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
  }
  s.renderer.style.cssText = "overflow-x:hidden;overflow-y:hidden";
  const clip = s.doc.createElement("div"); clip.style.overflowX = "hidden"; clip.style.overflowY = "hidden";
  s.marker.replaceWith(clip); clip.append(s.marker); s.setBox(clip, 0, 0, 10, 10);
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
  const foreign = document.createElement("span"); document.body.append(foreign);
  expect(pageMarkerPhysicallyVisible(foreign, s.doc, s.renderer)).toBe(false);
  s.frame.remove();
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
});

it("rejects legacy clip on a marker or frame ancestor despite an in-range client point", () => {
  const s = scene(), range = s.doc.createRange(); range.selectNodeContents(s.doc.body);
  expect(range.comparePoint(s.marker, 0)).toBe(0);
  expect(s.marker.getClientRects()).toHaveLength(1);
  s.marker.style.cssText = "position:absolute;clip:rect(0px,0px,0px,0px)";
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
  s.marker.style.cssText = "";
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(true);
  s.renderer.style.cssText = "position:absolute;overflow-x:hidden;overflow-y:hidden;clip:rect(0px,0px,0px,0px)";
  expect(s.marker.getClientRects()).toHaveLength(1);
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
});
it.each(["paint", "layout paint", "strict", "content"])("rejects%s paint containment on a document ancestor without overflow clipping", contain => {
  const s = scene(), box = s.doc.createElement("div");
  s.marker.replaceWith(box); box.append(s.marker);
  box.style.cssText = `contain:${contain};overflow-x:visible;overflow-y:visible`;
  s.setBox(box, 0, 0, 10, 10);
  const range = s.doc.createRange(); range.selectNodeContents(s.doc.body);
  expect(range.comparePoint(s.marker, 0)).toBe(0);
  expect(s.marker.getClientRects()).toHaveLength(1);
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
  box.style.contain = "none";
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(true);
});
it("rejects paint-containing shadow/host ancestors while retaining non-paint containment", () => {
  const s = scene();
  s.renderer.style.contain = "paint";
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
  s.renderer.style.contain = "layout style";
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(true);
  s.frame.style.contain = "strict";
  expect(pageMarkerPhysicallyVisible(s.marker, s.doc, s.renderer)).toBe(false);
});
