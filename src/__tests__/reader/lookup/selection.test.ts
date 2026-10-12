// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectionLanguage, selectionSentence, selectionHostRect, attachWordGestures } from "@/lib/reader/engines/foliate/selection";
import { mouseHitsWord } from "@/lib/reader/word-hit";
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });
function selected(html: string, text: string) {
  document.body.innerHTML = html;
  const walker = document.createTreeWalker(document.body, 4);
  let node: Node | null;
  while ((node = walker.nextNode())) if (node.textContent?.includes(text)) {
    const start = node.textContent.indexOf(text), range = document.createRange();
    range.setStart(node, start); range.setEnd(node, start + text.length);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    return range;
  }
  throw new Error("Fixture text absent");
}
describe("lookup selection source contracts", () => {
  it("uses nearest xml:lang before document metadata and finds the start sentence", () => {
    const range = selected('<div lang="en"><p>Before. <span xml:lang="la">Lux lucet. Alia sententia.</span></p></div>', "Lux");
    range.startContainer.parentElement!.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:lang", "la");
    expect(selectionLanguage(range.startContainer)).toBe("la");
    expect(selectionSentence(range, "la")).toBe("Lux lucet.");
  });
  it("limits a pathological chapter block and the recorded sentence", () => {
    const range = selected("<p>" + "x".repeat(70000) + " lux</p>", "lux");
    expect(selectionSentence(range, "la")).toBe("lux");
    const normal = selected("<p>" + "x".repeat(500) + " lux.</p>", "lux");
    expect(selectionSentence(normal, "en").length).toBeLessThanOrEqual(300);
  });
  it("maps measured iframe scale without inventing PDF glyph geometry", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const doc = frame.contentDocument!; doc.body.innerHTML = "<p>lux</p>";
    // Native iframe windows expose their owning frame; happy-dom needs the link.
    Object.defineProperty(doc.defaultView!, "frameElement", { configurable: true, value: frame });
    const range = doc.createRange(); range.selectNodeContents(doc.querySelector("p")!);
    vi.spyOn(range, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 30, 40));
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 200, 400, 600));
    Object.defineProperty(frame, "offsetWidth", { configurable: true, value: 200 });
    Object.defineProperty(frame, "offsetHeight", { configurable: true, value: 300 });
    expect(selectionHostRect(range).toJSON()).toMatchObject({ left: 120, top: 240, right: 180, bottom: 320 });
  });
  it("double click opens one native word but leaves passage selection alone", () => {
    selected("<p>lux lucet</p>", "lux");
    const open = vi.fn(), detach = attachWordGestures(document, open);
    document.querySelector("p")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
    expect(open).toHaveBeenCalledTimes(1);
    selected("<p>lux lucet</p>", "lux lucet");
    document.querySelector("p")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
    expect(open).toHaveBeenCalledTimes(1); detach();
  });
  it("leaves a touch hold to the browser's own selection", () => {
    // Opening the lookup under a held finger fought iOS's selection handles; Look up opens it.
    vi.useFakeTimers();
    selected("<p>lux</p>", "lux");
    const open = vi.fn(), detach = attachWordGestures(document, open);
    const event = new Event("touchstart", { bubbles: true });
    Object.defineProperty(event, "touches", { value: [{ identifier: 1, clientX: 10, clientY: 10 }] });
    document.querySelector("p")!.dispatchEvent(event);
    vi.advanceTimersByTime(1000);
    expect(open).not.toHaveBeenCalled(); detach();
  });
  it("mouse caret snapping into a paragraph gap does not suppress page zones", () => {
    document.body.innerHTML = "<p>lux</p>";
    const node = document.querySelector("p")!.firstChild!;
    Object.defineProperty(document, "caretPositionFromPoint", { configurable: true, value: () => ({ offsetNode: node, offset: 1 }) });
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([new DOMRect(10, 10, 8, 20)] as unknown as DOMRectList);
    expect(mouseHitsWord(document, 12, 15)).toBe(true);
    expect(mouseHitsWord(document, 50, 15)).toBe(false);
    Reflect.deleteProperty(document, "caretPositionFromPoint");
  });
});
