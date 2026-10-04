/** The inline styles the lock changes on the element that scrolls the page. */
export interface ScrollRoot {
  style: Pick<CSSStyleDeclaration, "overflow" | "scrollbarGutter">;
}

/**
 * Stops the page from scrolling while an overlay covers it (the phone
 * navigation drawer). The page scrolls on `html`, not `body`: globals.css
 * keeps `overflow-y: scroll` there, so a lock on `body` does nothing. The
 * scroll position stays as it was, and a stable gutter keeps the space of a
 * classic scrollbar, so the page does not move sideways.
 *
 * Returns a function that puts back the earlier inline styles.
 */
export function lockPageScroll(root: ScrollRoot): () => void {
  const { overflow, scrollbarGutter } = root.style;
  root.style.overflow = "hidden";
  root.style.scrollbarGutter = "stable";
  return () => {
    root.style.overflow = overflow;
    root.style.scrollbarGutter = scrollbarGutter;
  };
}
