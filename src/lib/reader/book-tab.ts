const TABBABLE =
  'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]';

/** The controls Tab visits in a document, in order: shown, enabled and not taken out of the order */
export function tabbables(doc: Document): HTMLElement[] {
  const view = doc.defaultView;
  return [...doc.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      !el.closest("[inert]") &&
      el.getClientRects().length > 0 &&
      view?.getComputedStyle(el).visibility !== "hidden",
  );
}

/**
 * Where Tab goes from inside a book's page (SLN-810): the next link or control
 * on this screen, or null when none is left. Never one on another page, where
 * focus would move the book under the reader.
 */
export function nextInBook(doc: Document, backwards: boolean, onScreen: (el: HTMLElement) => boolean): HTMLElement | null {
  const items = tabbables(doc).filter(onScreen);
  const from = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
  if (!from) return (backwards ? items.at(-1) : items[0]) ?? null;
  const following = (el: HTMLElement) => !!(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  return (backwards ? items.filter((el) => el !== from && !following(el)).at(-1) : items.find((el) => el !== from && following(el))) ?? null;
}

/**
 * Where Tab goes on leaving the book: the control after it in the page (the
 * page buttons and the bottom bar), or before it with Shift (the top bar).
 * Past either end it comes round to the other, as the page's own order would.
 */
export function besideBook(book: Element, backwards: boolean): HTMLElement | null {
  const items = tabbables(book.ownerDocument).filter((el) => !book.contains(el) && !el.contains(book));
  const after = (el: HTMLElement) => !!(book.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const next = backwards ? items.filter((el) => !after(el)).at(-1) : items.find(after);
  return next ?? (backwards ? items.at(-1) : items[0]) ?? null;
}

/**
 * Whether Tab from a reader control goes next into the book (SLN-826): the
 * book sits between it and the next control in that direction. The browser's
 * own order would then take focus to the first link in the drawn sections,
 * which may be in another chapter, and move the book to it.
 */
export function entersBook(book: Element, from: Element, backwards: boolean): boolean {
  if (book.contains(from)) return false;
  const items = tabbables(book.ownerDocument).filter((el) => !book.contains(el) && !el.contains(book));
  const at = items.indexOf(from as HTMLElement);
  if (at < 0) return false;
  const next = items[backwards ? at - 1 : at + 1];
  const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  return backwards
    ? before(book, from) && (!next || before(next, book))
    : before(from, book) && (!next || before(book, next));
}

/**
 * Where Tab lands on entering the book: the first link or control on this
 * screen going forward, the last going back, across the sections drawn now;
 * null when the screen has none.
 */
export function enterBook(docs: readonly Document[], backwards: boolean, onScreen: (el: HTMLElement) => boolean): HTMLElement | null {
  const items = docs.flatMap((doc) => tabbables(doc).filter(onScreen));
  return (backwards ? items.at(-1) : items[0]) ?? null;
}

/** Whether a link in one of the book's frames shows on this screen */
export function onBookScreen(book: Element): (el: HTMLElement) => boolean {
  const area = book.getBoundingClientRect();
  return (el) => {
    const frame = el.ownerDocument.defaultView?.frameElement;
    if (!frame) return false;
    const at = frame.getBoundingClientRect(), rect = el.getBoundingClientRect();
    const left = at.left + rect.left, top = at.top + rect.top;
    return left < area.right && left + rect.width > area.left && top < area.bottom && top + rect.height > area.top;
  };
}
