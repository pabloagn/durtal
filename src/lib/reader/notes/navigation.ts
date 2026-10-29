/** Only explicitly visited notes enter the section layout, until the next jump. */
export const OPEN_NOTE_ATTRIBUTE = "data-durtal-note-target";
export const OPEN_NOTE_CSS = `aside[${OPEN_NOTE_ATTRIBUTE}] { display: block !important; }`;

function isNote(element: Element): boolean {
  if (element.localName !== "aside") return false;
  const types = (element.getAttribute("epub:type") ?? element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? "").split(/\s+/);
  const roles = (element.getAttribute("role") ?? "").split(/\s+/);
  return types.some(type => ["footnote", "endnote", "note", "rearnote"].includes(type)) ||
    roles.some(role => ["doc-footnote", "doc-endnote"].includes(role));
}

export function clearNavigatedNotes(doc: Document): void {
  for (const note of doc.querySelectorAll(`[${OPEN_NOTE_ATTRIBUTE}]`)) note.removeAttribute(OPEN_NOTE_ATTRIBUTE);
}

/** Accept native ranges as well as element anchors (including cross-frame objects). */
export function revealNavigatedNote(doc: Document, anchor: Range | Element): void {
  clearNavigatedNotes(doc);
  const node = "startContainer" in anchor ? anchor.startContainer : anchor;
  let element = node.nodeType === 1 ? node as Element : node.parentElement;
  while (element) {
    if (isNote(element)) element.setAttribute(OPEN_NOTE_ATTRIBUTE, "");
    element = element.parentElement;
  }
}
