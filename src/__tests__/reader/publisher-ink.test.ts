// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { PublisherInk, computedPublisherInk } from "@/lib/reader/engines/foliate/publisher-ink";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";
import { adaptTextColour, themeColours } from "@/lib/reader/presentation/themes";
import { contrastRatio } from "@/lib/reader/presentation/contrast";
const frames: HTMLIFrameElement[] = [];
afterEach(() => { frames.splice(0).forEach(frame => frame.remove()); });
function page() {
  const frame = document.createElement("iframe"); document.body.append(frame); frames.push(frame);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = '<p style="color:rgb(120,0,0);font-size:21px">Rubric</p><p style="color:rgba(0,0,0,0)">Hidden text</p><svg><text fill="#770000">Art</text></svg>';
  return doc;
}
describe("publisher ink contrast (DOM source contracts)", () => {
  it("resolves native RGB forms while retaining transparent text", () => {
    expect(computedPublisherInk("rgb(100% 0% 0% / 50%)")).toEqual({ hex: "#ff0000", alpha: .5 });
    expect(computedPublisherInk("color(srgb 1 0 0)")).toEqual({ hex: "#ff0000", alpha: 1 });
    expect(computedPublisherInk("rgba(0,0,0,0)")?.alpha).toBe(0);
  });
  it("uses the original publisher colour across repeated themes without changing font size or art", async () => {
    const doc = page(), ink = new PublisherInk(), owner = new AbortController();
    ink.apply(doc,PRESENTATION_DEFAULTS.desktop,owner.signal); await ink.ready(doc,owner.signal);
    const p = doc.querySelector("p")!;
    expect(p.style.fontSize).toBe("21px"); expect(doc.querySelector("svg text")!.getAttribute("fill")).toBe("#770000");
    const paper = { ...PRESENTATION_DEFAULTS.desktop, theme: "paper" as const };
    ink.apply(doc,paper,owner.signal); await ink.ready(doc,owner.signal);
    expect(computedPublisherInk(p.style.color)?.hex).toBe(adaptTextColour("#780000",paper));
    expect(contrastRatio(computedPublisherInk(p.style.color)!.hex,themeColours(paper).background)).toBeGreaterThanOrEqual(4.5);
    expect(doc.querySelectorAll("p")[1].style.color).toContain("0");
  });
  it("rejects a cancelled owner before touching publisher ink", async () => {
    const doc = page(), ink = new PublisherInk(), owner = new AbortController(); owner.abort();
    const before = doc.querySelector("p")!.getAttribute("style");
    ink.apply(doc,PRESENTATION_DEFAULTS.desktop,owner.signal);
    await expect(ink.ready(doc,owner.signal)).rejects.toHaveProperty("name","AbortError");
    expect(doc.querySelector("p")!.getAttribute("style")).toBe(before);
  });
});
