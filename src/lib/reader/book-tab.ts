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
