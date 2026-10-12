import { rangeOffsets, textOffsets } from "./offsets";
import { checkAbort, yieldReaderTask } from "./task";

export const NOTE_SELECTOR =
  'aside[epub\\:type~="footnote"], aside[epub\\:type~="endnote"], aside[epub\\:type~="note"], aside[epub\\:type~="rearnote"], [role~="doc-footnote"], [role~="doc-endnote"]';

/** Work against the pristine section; reader controls and wrappers never enter this index. */
export async function collectSearchText(doc: Document, signal: AbortSignal) {
  const root = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(root, 1 | 4 | 8, {
    acceptNode(node) {
      if (node.nodeType === 1) {
        const el = node as Element;
        return /^(script|style|noscript|template)$/i.test(el.localName) ||
          el.hasAttribute("data-reader-chrome")
          ? 2
          : 3;
      }
      return node.nodeValue?.length ? 1 : 3;
    },
  });
  const nodes: Text[] = [];
  const strings: string[] = [];
  let budget = performance.now();
  let count = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    checkAbort(signal);
    nodes.push(node as Text);
    strings.push(node.nodeValue ?? "");
    if (++count === 2000 || performance.now() - budget >= 8) {
      await yieldReaderTask(signal);
      budget = performance.now();
      count = 0;
    }
  }
  checkAbort(signal);
  const offsets = textOffsets(strings);
  return {
    text: strings.join(""),
    range(start: number, end: number) {
      const boundaries = rangeOffsets(offsets, start, end);
      const range = doc.createRange();
      range.setStart(nodes[boundaries.start.index], boundaries.start.offset);
      range.setEnd(nodes[boundaries.end.index], boundaries.end.offset);
      return range;
    },
  };
}

export function searchExcerpt(text: string, start: number, end: number) {
  const whitespace = (value: string) => value.replace(/\s+/g, " ");
  return {
    before:
      (start > 50 ? "…" : "") +
      whitespace(text.slice(Math.max(0, start - 50), start)),
    match: whitespace(text.slice(start, end)),
    after:
      whitespace(text.slice(end, end + 50)) +
      (end + 50 < text.length ? "…" : ""),
  };
}
