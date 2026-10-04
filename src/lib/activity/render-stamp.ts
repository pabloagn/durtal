/**
 * A value that changes on every server render of a page. Passed to the
 * activity timeline, it makes the history reload after a save refreshes the
 * page, whichever dialog made the change.
 */
export function renderStamp() {
  return new Date().toISOString();
}
