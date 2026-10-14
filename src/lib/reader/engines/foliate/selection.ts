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
  return frameRectToHost(range.getBoundingClientRect(), range.startContainer.ownerDocument);
}

/** A rect measured inside a book frame, in the host page's viewport coordinates */
export function frameRectToHost(bounds: DOMRectReadOnly, doc: Document | null): DOMRectReadOnly {
  const frame = doc?.defaultView?.frameElement;
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

/**
 * A double click on one word opens the lookup. Touch has no gesture of its
 * own: a long press is the browser's, which selects the word and shows the
 * iOS edit menu, and the selection's Look up button opens the lookup. A
 * lookup that opened under a held finger fought the native selection handles.
 */
export function attachWordGestures(doc: Document, open: (input: "mouse", range: Range) => void): () => void {
  const eligible = () => {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !oneWord(selection.toString())) return null;
    const range = selection.getRangeAt(0);
    if (range.startContainer.ownerDocument !== doc || range.endContainer.ownerDocument !== doc) return null;
    return range.cloneRange();
  };
  const double = (event: MouseEvent) => {
    if (event.button !== 0 || event.defaultPrevented ||
      (event.target as Element | null)?.closest?.("a,button,input,textarea,select,[contenteditable]")) return;
    const range = eligible();
    if (range) open("mouse", range);
  };
  doc.addEventListener("dblclick", double);
  return () => doc.removeEventListener("dblclick", double);
}
