/*
 * A selection stops at the edge of the screen (SLN-682). A paginated book's
 * frame holds every column of its section, so a drag just past the last line
 * went on into the next, unseen page and selected thousands of characters.
 * The words read in order, so the ones on screen are one run: the selection
 * keeps that run and drops what lies beyond it, on either side.
 */

interface Piece {
  node: Text;
  start: number;
  end: number;
  /** Characters before this piece in the selection */
  at: number;
}

function pieces(range: Range): Piece[] {
  const doc = range.startContainer.ownerDocument!;
  const root = range.commonAncestorContainer;
  const out: Piece[] = [];
  let at = 0;
  const add = (node: Text) => {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    if (end <= start) return;
    out.push({ node, start, end, at });
    at += end - start;
  };
  if (root.nodeType === Node.TEXT_NODE) {
    add(root as Text);
    return out;
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (range.intersectsNode(node)) add(node as Text);
  return out;
}

/** The text position of the k-th selected character */
function locate(list: Piece[], k: number): { node: Text; offset: number } {
  let lo = 0, hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].at <= k) lo = mid;
    else hi = mid - 1;
  }
  const piece = list[lo];
  return { node: piece.node, offset: piece.start + (k - piece.at) };
}

/**
 * The part of `range` on screen, or null when all of it shows (or none of
 * it does, which leaves it to the reader). `shows` says whether a character's
 * box, in the range's own document, is on screen.
 */
export function rangeOnScreen(range: Range, shows: (rect: DOMRect) => boolean): Range | null {
  if (range.collapsed) return null;
  const list = pieces(range);
  const total = list.length ? list.at(-1)!.at + list.at(-1)!.end - list.at(-1)!.start : 0;
  if (!total) return null;
  const doc = range.startContainer.ownerDocument!;
  const probe = doc.createRange();
  /** Whether character k shows; null when it has no box (collapsed white space) */
  const own = (k: number): boolean | null => {
    const { node, offset } = locate(list, k);
    probe.setStart(node, offset);
    probe.setEnd(node, offset + 1);
    const rects = Array.from(probe.getClientRects()).filter(rect => rect.width > 0 || rect.height > 0);
    return rects.length ? rects.some(shows) : null;
  };
  // A character with no box takes the answer of the nearest one that has one
  const visible = (k: number): boolean => {
    for (let d = 0; d < 16; d++) {
      const after = k + d < total ? own(k + d) : null;
      if (after !== null) return after;
      const before = k - d >= 0 ? own(k - d) : null;
      if (before !== null) return before;
    }
    return false;
  };
  const first = visible(0), last = visible(total - 1);
  if (first && last) return null;
  if (!first && !last) return null;
  let from = 0, to = total;
  if (first) {
    // [0, lo] shows, hi does not
    let lo = 0, hi = total - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (visible(mid)) lo = mid;
      else hi = mid;
    }
    to = lo + 1;
  } else {
    // lo does not show, [hi, total) does
    let lo = 0, hi = total - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (visible(mid)) hi = mid;
      else lo = mid;
    }
    from = hi;
  }
  const start = locate(list, from), end = locate(list, to - 1);
  const kept = doc.createRange();
  kept.setStart(start.node, start.offset);
  kept.setEnd(end.node, end.offset + 1);
  return kept.toString().trim() ? kept : null;
}

/**
 * Keeps a document's selection to what shows, holding its anchor where the
 * reader started. True when it changed the selection.
 */
export function keepSelectionOnScreen(doc: Document, shows: (rect: DOMRect) => boolean): boolean {
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const kept = rangeOnScreen(range, shows);
  if (!kept) return false;
  const anchor = selection.anchorNode, anchorOffset = selection.anchorOffset;
  const forward = anchor === range.startContainer && anchorOffset === range.startOffset;
  if (forward) selection.setBaseAndExtent(kept.startContainer, kept.startOffset, kept.endContainer, kept.endOffset);
  else selection.setBaseAndExtent(kept.endContainer, kept.endOffset, kept.startContainer, kept.startOffset);
  return true;
}
