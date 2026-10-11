// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublisherInk, computedPublisherInk } from "@/lib/reader/engines/foliate/publisher-ink";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";
import { adaptTextColour, themeColours } from "@/lib/reader/presentation/themes";
import { contrastRatio } from "@/lib/reader/presentation/contrast";
const frames: HTMLIFrameElement[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); frames.splice(0).forEach(frame => frame.remove()); });
function page() {
  const frame = document.createElement("iframe"); document.body.append(frame); frames.push(frame);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = '<p style="color:rgb(120,0,0);font-size:21px">Rubric</p><p style="color:rgba(0,0,0,0)">Hidden text</p><svg><text fill="#770000">Art</text></svg>';
  return doc;
}
/** Whole-sheet changes invalidate backgrounds across the chapter; foreground-only
 * changes retain that paint policy and leave cheaper inherited-ink work. */
function paintedCascade() {
  vi.useFakeTimers();
  const doc = page();
  doc.body.innerHTML = Array.from({ length: 1024 }, (_, at) => at === 512
    ? '<p data-transparent style="color:rgba(0,0,0,0)">Hidden</p>'
    : '<p>Publisher ink</p>').join("");
  const style = doc.createElement("style");
  style.setAttribute("data-durtal-page-colours", "");
  style.textContent = "html, body { color: #eeeeee !important; color-scheme: dark; background-color: #07090d !important; } body * { background-color: transparent !important; } img { filter: brightness(.9); } :where(a) { color: #eeeeee; }";
  doc.head.append(style);
  const sheet = style.sheet!;
  const rootInk = (sheet.cssRules[0] as CSSStyleRule).style;
  const background = (sheet.cssRules[1] as CSSStyleRule).style;
  const media = (sheet.cssRules[2] as CSSStyleRule).style;
  const before = { ink: rootInk.getPropertyValue("color"), priority: rootInk.getPropertyPriority("color"), scheme: rootInk.getPropertyValue("color-scheme"), rootBackground: rootInk.getPropertyValue("background-color"), childBackground: background.getPropertyValue("background-color"), filter: media.getPropertyValue("filter") };
  const fontStyle = doc.createElement("style");
  fontStyle.textContent = "@font-face { font-family: Publisher; src: local(Georgia); }";
  doc.head.append(fontStyle);
  let disabled = false, cost = 0, now = 0, toggles = 0, reads = 0;
  Object.defineProperty(sheet, "disabled", {
    configurable: true,
    get: () => disabled,
    set: (value: boolean) => { if (value !== disabled) { disabled = value; cost = 12; toggles++; } },
  });
  const remove = rootInk.removeProperty.bind(rootInk);
  vi.spyOn(rootInk, "removeProperty").mockImplementation(name => { cost = Math.max(cost, 2); return remove(name); });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(doc.defaultView!, "getComputedStyle").mockImplementation(element => {
    expect(sheet.disabled).toBe(false);
    expect(rootInk.getPropertyValue("color")).toBe("");
    expect(rootInk.getPropertyValue("color-scheme")).toBe("");
    expect(rootInk.getPropertyValue("background-color")).toBe(before.rootBackground);
    expect(background.getPropertyValue("background-color")).toBe(before.childBackground);
    expect(media.getPropertyValue("filter")).toBe(before.filter);
    expect(fontStyle.sheet!.disabled).not.toBe(true);
    now += cost + .02; cost = 0; reads++;
    return { color: element.hasAttribute("data-transparent") ? "rgba(0, 0, 0, 0)" : "rgb(120, 0, 0)" } as CSSStyleDeclaration;
  });
  const restored = () => {
    expect(sheet.disabled).toBe(false);
    expect(rootInk.getPropertyValue("color")).toBe(before.ink);
    expect(rootInk.getPropertyPriority("color")).toBe(before.priority);
    expect(rootInk.getPropertyValue("color-scheme")).toBe(before.scheme);
  };
  return { doc, restored, counts: () => ({ toggles, reads }) };
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
  it("captures long-document source ink with backgrounds and media installed, restoring before yields", async () => {
    const { doc, restored, counts } = paintedCascade();
    const ink = new PublisherInk(), owner = new AbortController();
    ink.apply(doc, PRESENTATION_DEFAULTS.desktop, owner.signal);
    restored(); // apply returned at the first yield; painted foreground must already be restored.
    await Promise.all([ink.ready(doc, owner.signal), vi.runAllTimersAsync()]);
    restored();
    expect(counts()).toEqual({ toggles: 0, reads: 1024 });
    const expected = adaptTextColour("#780000", PRESENTATION_DEFAULTS.desktop);
    for (const element of doc.querySelectorAll("p:not([data-transparent])"))
      expect(computedPublisherInk((element as HTMLElement).style.color)?.hex).toBe(expected);
    expect(computedPublisherInk((doc.querySelector("[data-transparent]") as HTMLElement).style.color)?.alpha).toBe(0);
    ink.apply(doc, { ...PRESENTATION_DEFAULTS.desktop, theme: "paper" }, owner.signal);
    restored();
    await Promise.all([ink.ready(doc, owner.signal), vi.runAllTimersAsync()]);
    expect(counts()).toEqual({ toggles: 0, reads: 1024 });
  });
  it("keeps themed foreground restored when a yielded capture is cancelled or replaced", async () => {
    const { doc, restored, counts } = paintedCascade();
    const ink = new PublisherInk(), owner = new AbortController();
    ink.apply(doc, PRESENTATION_DEFAULTS.desktop, owner.signal);
    restored();
    const cancelled = expect(ink.ready(doc, owner.signal)).rejects.toHaveProperty("name", "AbortError");
    owner.abort();
    restored();
    await cancelled;
    const replacement = new AbortController();
    ink.apply(doc, PRESENTATION_DEFAULTS.desktop, replacement.signal);
    restored();
    ink.apply(doc, PRESENTATION_DEFAULTS.desktop, replacement.signal);
    restored();
    await Promise.all([ink.ready(doc, replacement.signal), vi.runAllTimersAsync()]);
    restored();
    expect(counts().toggles).toBe(0);
    expect(counts().reads).toBe(1024);
  });
});
