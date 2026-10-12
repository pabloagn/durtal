import type { DurtalLocator, SelectionDetails } from "../../engine";

/** Only book markup supplies passage language; metadata is a later fallback. */
export function selectionLanguage(node: Node): string | null {
  let element = node.nodeType === 1 ? node as Element : node.parentElement;
  while (element) {
    const value = element.getAttribute("lang")?.trim() ||
      element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang")?.trim();
    if (value?.trim()) return value;
    element = element.parentElement;
  }
  return null;
}

/** Measured iframe scaling applies equally to reflowable, fixed and PDF text. */
export function selectionHostRect(range: Range): DOMRectReadOnly {
  const bounds = range.getBoundingClientRect();
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
  const host = frame?.getBoundingClientRect();
  const scaleX = host && frame ? host.width / ((frame as HTMLElement).offsetWidth || host.width || 1) : 1;
  const scaleY = host && frame ? host.height / ((frame as HTMLElement).offsetHeight || host.height || 1) : 1;
  return new DOMRectReadOnly(
    (host?.left ?? 0) + bounds.left * scaleX,
    (host?.top ?? 0) + bounds.top * scaleY,
    bounds.width * scaleX, bounds.height * scaleY,
  );
}

export function selectionSentence(range: Range, language: string | null): string {
  const node = range.startContainer;
  const parent = node.nodeType === 1 ? node as Element : node.parentElement;
  const block = parent?.closest("p,li,dd,dt,blockquote,pre,h1,h2,h3,h4,h5,h6,div") ?? parent;
  if (!block) return range.toString().slice(0, 300);
  // Hostile books may put a whole chapter in one block. Bound traversal and retained text.
  const walker = block.ownerDocument.createTreeWalker(block, 4);
  const prefix = range.cloneRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(range.startContainer, range.startOffset);
  let text = "", start = 0, found = false, nodes = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (++nodes > 4096 || text.length + (current.textContent?.length ?? 0) > 65536)
      return range.toString().slice(0, 300);
    const value = current.textContent ?? "";
    if (current === range.startContainer) { start = text.length + range.startOffset; found = true; }
    else if (!found && prefix.comparePoint(current, 0) === 0) start = text.length + value.length;
    text += value;
  }
  let segmenter: Intl.Segmenter;
  try { segmenter = new Intl.Segmenter(language ?? "en", { granularity: "sentence" }); }
  catch { segmenter = new Intl.Segmenter("en", { granularity: "sentence" }); }
  for (const sentence of segmenter.segment(text))
    if (sentence.index + sentence.segment.length > start)
      return sentence.segment.trim().slice(0, 300);
  return text.slice(Math.max(0, start - 150), start + 150).trim();
}

export function detailsFromRange(range: Range, locator: DurtalLocator): SelectionDetails {
  const lang = selectionLanguage(range.startContainer);
  return { text: range.toString(), locator, lang, sentence: selectionSentence(range, lang),
    rect: selectionHostRect(range) };
}

function oneWord(text: string): boolean {
  let count = 0;
  for (const segment of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text))
    if (segment.isWordLike && ++count > 1) return false;
  return count === 1;
}

/** Native selection remains the browser's job, including the iOS edit menu. */
export function attachWordGestures(doc: Document, open: (input: "mouse" | "touch", range: Range) => void): () => void {
  let touch: { id: number; x: number; y: number; at: number; moved: boolean; opened: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (timer) clearTimeout(timer); timer = null; };
  const eligible = () => {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !oneWord(selection.toString())) return null;
    const range = selection.getRangeAt(0);
    if (range.startContainer.ownerDocument !== doc || range.endContainer.ownerDocument !== doc) return null;
    if (!touch) return range.cloneRange();
    // A held margin must not reopen an unrelated word selected before the touch.
    return Array.from(range.getClientRects()).some(rect =>
      touch!.x >= rect.left - 10 && touch!.x <= rect.right + 10 &&
      touch!.y >= rect.top - 10 && touch!.y <= rect.bottom + 10) ? range.cloneRange() : null;
  };
  const tryOpen = () => {
    if (touch && !touch.moved && !touch.opened && performance.now() - touch.at >= 450) {
      const range = eligible();
      if (range) { touch.opened = true; open("touch", range); }
    }
  };
  const double = (event: MouseEvent) => {
    if (event.button !== 0 || event.defaultPrevented ||
      (event.target as Element | null)?.closest?.("a,button,input,textarea,select,[contenteditable]")) return;
    const range = eligible();
    if (range) open("mouse", range);
  };
  const start = (event: TouchEvent) => {
    clear(); touch = null;
    if (event.touches.length !== 1 || (event.target as Element | null)?.closest?.("a,button,input,textarea,select,[contenteditable]")) return;
    const point = event.touches[0];
    touch = { id: point.identifier, x: point.clientX, y: point.clientY, at: performance.now(), moved: false, opened: false };
    timer = setTimeout(tryOpen, 450);
  };
  const move = (event: TouchEvent) => {
    if (!touch) return;
    const point = Array.from(event.touches).find(point => point.identifier === touch?.id);
    if (!point || event.touches.length !== 1 || Math.hypot(point.clientX-touch.x, point.clientY-touch.y) >= 10) {
      touch.moved = true; clear();
    }
  };
  const end = (event: TouchEvent) => {
    moveEnd(event); tryOpen(); clear(); touch = null;
  };
  const moveEnd = (event: TouchEvent) => {
    if (!touch) return;
    const point = Array.from(event.changedTouches).find(point => point.identifier === touch?.id);
    if (!point || Math.hypot(point.clientX-touch.x, point.clientY-touch.y) >= 10 || event.touches.length)
      touch.moved = true;
  };
  const cancel = () => { clear(); touch = null; };
  doc.addEventListener("dblclick", double);
  doc.addEventListener("touchstart", start, { passive: true });
  doc.addEventListener("touchmove", move, { passive: true });
  doc.addEventListener("touchend", end, { passive: true });
  doc.addEventListener("touchcancel", cancel, { passive: true });
  doc.addEventListener("selectionchange", tryOpen);
  return () => {
    cancel(); doc.removeEventListener("dblclick", double);
    doc.removeEventListener("touchstart", start); doc.removeEventListener("touchmove", move);
    doc.removeEventListener("touchend", end); doc.removeEventListener("touchcancel", cancel);
    doc.removeEventListener("selectionchange", tryOpen);
  };
}
