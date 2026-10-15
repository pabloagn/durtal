/** Keys that move the reader's own focus: a tooltip shows for the focus that
 * follows one of them, and not for focus the app moves itself */
const MOVING_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

let movedAt = -Infinity;

/** Note a key that went down, in this window or in a watched page */
export function noteTooltipKey(event: KeyboardEvent) {
  movedAt = MOVING_KEYS.has(event.key) ? performance.now() : -Infinity;
}

/** When one of those keys last went down */
export function tooltipKeyMovedAt() {
  return movedAt;
}

export function resetTooltipKeys() {
  movedAt = -Infinity;
}

/** A page in a frame (the reader's book) reports its keys too, so Tab from
 * the book onto the reader's controls shows their tooltips; key presses
 * inside a frame never reach the top window */
export function watchTooltipKeys(doc: Document) {
  doc.addEventListener("keydown", noteTooltipKey, true);
  return () => doc.removeEventListener("keydown", noteTooltipKey, true);
}
