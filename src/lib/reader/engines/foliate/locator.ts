import type { DurtalLocator } from "@/lib/reader/engine";
import { normalizeQuoteText, type TextQuote } from "./quote-match";

/**
 * DurtalLocators from the engine's places (eBooks sub-issue 3). A locator
 * carries the CFI for this file and, for when the file changes, the text at
 * the place with up to 64 characters of context on each side.
 */

/** At most this many characters of quote and of context on each side */
export const QUOTE_CHARS = 64;

const TEXT = 3;
const SHOW_TEXT = 4;

function deepLast(node: Node): Node {
  while (node.lastChild) node = node.lastChild;
  return node;
}

/** The text before a point, nearest first: the part of its own node, then whole nodes */
function* textsBefore(root: Node, container: Node, offset: number): Generator<string> {
  const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, SHOW_TEXT);
  if (container.nodeType === TEXT) {
    yield (container as Text).data.slice(0, offset);
    walker.currentNode = container;
  } else if (offset > 0) {
    const last = deepLast(container.childNodes[offset - 1]);
    if (last.nodeType === TEXT) yield (last as Text).data;
    walker.currentNode = last;
  } else walker.currentNode = container;
  for (let node = walker.previousNode(); node; node = walker.previousNode()) yield (node as Text).data;
}

/** The text after a point, nearest first */
function* textsAfter(root: Node, container: Node, offset: number): Generator<string> {
  const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, SHOW_TEXT);
  if (container.nodeType === TEXT) {
    yield (container as Text).data.slice(offset);
    walker.currentNode = container;
  } else if (offset < container.childNodes.length) {
    const first = container.childNodes[offset];
    if (first.nodeType === TEXT) yield (first as Text).data;
    // An element: its first text comes next
    walker.currentNode = first;
  } else walker.currentNode = deepLast(container);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) yield (node as Text).data;
}

/** Up to `limit` characters of text before a point, in reading order */
function textBefore(root: Node, container: Node, offset: number, limit: number): string {
  let text = "";
  for (const part of textsBefore(root, container, offset)) {
    text = part + text;
    if (normalizeQuoteText(text).length > limit) break;
  }
  const normal = normalizeQuoteText(text);
  return normal.slice(Math.max(0, normal.length - limit));
}

/** Up to `limit` characters of text after a point */
function textAfter(root: Node, container: Node, offset: number, limit: number): string {
  let text = "";
  for (const part of textsAfter(root, container, offset)) {
    text += part;
    if (normalizeQuoteText(text).length > limit) break;
  }
  return normalizeQuoteText(text).slice(0, limit);
}

/**
 * The quote at the start of a range: its first characters, and the text on
 * either side. A long range (a whole page) gives its first 64 characters.
 */
export function quoteAt(range: Range): TextQuote | undefined {
  const root = range.startContainer.ownerDocument?.body;
  if (!root) return undefined;
  const fromRange = normalizeQuoteText(range.toString().slice(0, QUOTE_CHARS * 4)).trimStart();
  // A collapsed place quotes the text that follows it
  const quoted = fromRange || textAfter(root, range.startContainer, range.startOffset, QUOTE_CHARS * 2).trimStart();
  const highlight = quoted.slice(0, QUOTE_CHARS);
  if (!highlight.trim()) return undefined;
  const before = textBefore(root, range.startContainer, range.startOffset, QUOTE_CHARS);
  // After the quote: from the end of the range when it is short, else after the first 64 characters
  const rest = !fromRange
    ? quoted.slice(highlight.length)
    : fromRange.length > highlight.length
      ? fromRange.slice(highlight.length) + textAfter(root, range.endContainer, range.endOffset, QUOTE_CHARS)
      : textAfter(root, range.endContainer, range.endOffset, QUOTE_CHARS);
  const after = rest.slice(0, QUOTE_CHARS);
  return {
    ...(before ? { before } : {}),
    highlight,
    ...(after ? { after } : {}),
  };
}

export interface RelocateInput {
  fileHash: string;
  sectionIndex: number;
  href: string;
  /** Within the section, 0 to 1 */
  sectionFraction: number;
  /** Within the book, 0 to 1 */
  fraction: number;
  /** The engine's size-based location */
  location?: number;
  cfi?: string;
  range?: Range | null;
  tocLabel?: string;
  pageLabel?: string;
  /** PDFs: the page, from 1 */
  pdfPage?: number;
}

const unit = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** A relocate from the engine as a DurtalLocator */
export function locatorFromRelocate(input: RelocateInput): DurtalLocator {
  const locator: DurtalLocator = {
    v: 1,
    fileHash: input.fileHash,
    href: input.href,
    sectionIndex: input.sectionIndex,
    progression: unit(input.sectionFraction),
    totalProgression: unit(input.fraction),
  };
  if (Number.isFinite(input.location)) locator.position = input.location;
  if (input.pdfPage) {
    locator.pdf = { page: input.pdfPage };
  } else if (input.cfi) {
    locator.cfi = input.cfi;
  }
  const text = input.range && !input.pdfPage ? quoteAt(input.range) : undefined;
  if (text) locator.text = text;
  if (input.tocLabel?.trim()) locator.tocLabel = input.tocLabel.trim().slice(0, 300);
  if (input.pageLabel?.trim()) locator.pageLabel = input.pageLabel.trim().slice(0, 40);
  return locator;
}
