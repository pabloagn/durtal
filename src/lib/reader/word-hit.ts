/** Mouse page zones exclude actual word glyphs, rather than whole paragraphs. */
export function mouseHitsWord(doc: Document, x: number, y: number): boolean {
  const caret = (doc as Document & {
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?(x: number, y: number): Range | null;
  });
  const position = caret.caretPositionFromPoint?.(x, y);
  const fallback = !position ? caret.caretRangeFromPoint?.(x, y) : null;
  const node = position?.offsetNode ?? fallback?.startContainer;
  const offset = position?.offset ?? fallback?.startOffset;
  if (!node || node.nodeType !== 3 || offset === undefined) return false;
  const value = node.textContent ?? "";
  // Carets in a paragraph gap snap to a text node; only painted glyph rectangles count.
  for (const index of [offset, offset - 1]) {
    if (index < 0 || index >= value.length || !/[\p{L}\p{N}]/u.test(value[index])) continue;
    const range = doc.createRange();
    range.setStart(node, index); range.setEnd(node, index + 1);
    if (Array.from(range.getClientRects()).some(rect => x >= rect.left && x <= rect.right &&
      y >= rect.top && y <= rect.bottom)) return true;
  }
  return false;
}
