import type { ReaderAnnotation } from "./annotations";
import type { DurtalLocator } from "./engine";

/*
 * A passage marked twice is one mark (SLN-682). A new highlight, underline or
 * note on the passage of an existing mark changes that mark instead, so the
 * panel and the book page never list the same words twice.
 */

/** The same passage: one CFI range, or on a PDF one page with the same words in the same context */
export function samePassage(a: DurtalLocator, b: DurtalLocator): boolean {
  if (a.fileHash !== b.fileHash) return false;
  if (a.pdf || b.pdf) {
    if (!a.pdf || !b.pdf || a.pdf.page !== b.pdf.page) return false;
    const x = a.text, y = b.text;
    return !!x?.highlight && x.highlight === y?.highlight &&
      (x.before ?? "") === (y.before ?? "") && (x.after ?? "") === (y.after ?? "");
  }
  return !!a.cfi && a.cfi === b.cfi;
}

/** The live highlight, underline or quote in this file on the same passage, if any */
export function markOnPassage(
  annotations: readonly ReaderAnnotation[],
  fileId: string,
  locator: DurtalLocator,
): ReaderAnnotation | null {
  return annotations.find(item => item.kind === "highlight" && !item.deletedAt &&
    item.fileId === fileId && item.anchorState !== "orphaned" && samePassage(item.locator, locator)) ?? null;
}
