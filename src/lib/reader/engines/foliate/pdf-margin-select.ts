/**
 * A mouse drag in a PDF that starts beside a line (in the margin, or in a gap
 * between the text layer's spans) selects from that line. Begun on the bare
 * text layer, the browser took the page's start (Firefox, WebKit) or the line
 * above (Chromium) as the selection's start (SLN-670). Such a drag is driven
 * here, from the line's nearest end to the point under the pointer; a drag
 * that starts on text, a touch and a Shift-click stay the browser's.
 */

/** How far beside a line a drag still starts on it, in page pixels */
export const MARGIN_SELECT_PX = 64;

type TextPoint = { node: Text; offset: number };

const attached = new WeakSet<Element>();

function caretAt(doc: Document, container: Element, x: number, y: number): TextPoint | null {
  const position = doc.caretPositionFromPoint?.(x, y);
  const range = position ? null : doc.caretRangeFromPoint?.(x, y);
  const node = position ? position.offsetNode : range?.startContainer;
  if (node?.nodeType !== Node.TEXT_NODE || !container.contains(node)) return null;
  return { node: node as Text, offset: position ? position.offset : range!.startOffset };
}

/** The point in the text nearest (x, y) on the line through y, at most
 * `near` px beside it */
export function textPointNear(container: Element, x: number, y: number, near: number): TextPoint | null {
  const doc = container.ownerDocument;
  let best: { span: Element; distance: number; after: boolean } | null = null;
  for (const span of container.querySelectorAll("span")) {
    if (span.firstElementChild || !span.textContent?.trim()) continue;
    const r = span.getBoundingClientRect();
    if (!r.width || y < r.top || y > r.bottom) continue;
    const distance = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (distance > near || (best && best.distance <= distance)) continue;
    best = { span, distance, after: x > r.right };
  }
  if (!best) return null;
  if (best.distance === 0) {
    const caret = caretAt(doc, container, x, y);
    if (caret && best.span.contains(caret.node)) return caret;
  }
  const walker = doc.createTreeWalker(best.span, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode() as Text | null;
  if (!first) return null;
  let last = first;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node as Text;
  return best.after && best.distance > 0 ? { node: last, offset: last.length } : { node: first, offset: 0 };
}

/** Once per page document: drive a drag that starts beside a line */
export function attachMarginSelect(doc: Document) {
  const container = doc.querySelector(".textLayer");
  if (!container || attached.has(container)) return;
  attached.add(container);
  let start: TextPoint | null = null;
  container.addEventListener("pointerdown", (event) => {
    const e = event as PointerEvent;
    start = null;
    if (e.pointerType !== "mouse" || e.button !== 0 || e.shiftKey) return;
    const under = doc.elementFromPoint(e.clientX, e.clientY);
    if (under?.tagName === "SPAN" && container.contains(under) && under.textContent?.trim()) return;
    const point = textPointNear(container, e.clientX, e.clientY, MARGIN_SELECT_PX);
    const selection = doc.getSelection();
    if (!point || !selection) return;
    start = point;
    selection.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
    (container as HTMLElement).setPointerCapture?.(e.pointerId);
  });
  // The browser's own selection would start at the pointer
  container.addEventListener("mousedown", (event) => {
    if (start) event.preventDefault();
  });
  container.addEventListener("pointermove", (event) => {
    if (!start) return;
    const e = event as PointerEvent;
    const focus = textPointNear(container, e.clientX, e.clientY, Infinity);
    if (focus) doc.getSelection()?.setBaseAndExtent(start.node, start.offset, focus.node, focus.offset);
  });
  const end = (event: Event) => {
    if (!start) return;
    start = null;
    const id = (event as PointerEvent).pointerId;
    if ((container as HTMLElement).hasPointerCapture?.(id)) (container as HTMLElement).releasePointerCapture(id);
  };
  container.addEventListener("pointerup", end);
  container.addEventListener("pointercancel", end);
}
