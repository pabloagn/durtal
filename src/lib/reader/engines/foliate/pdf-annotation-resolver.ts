import type { AnnotationResolveResult, DurtalLocator } from "../../engine";
import type { PdfTextProvider } from "./pdf-text-provider";
import { matchAnnotationQuote } from "./annotation-anchor";
import { pdfHealingPages } from "./pdf-geometry";
import { speechYield } from "../../speech/dom-sentences";

/** Actual opened-page text and measured user-unit ranges, independent of navigation. */
export async function resolvePdfAnnotation(input: {
  provider: PdfTextProvider; hash: string; pageCount: number;
  annotation: { kind: "highlight" | "bookmark"; locator: DurtalLocator };
  signal: AbortSignal;
}): Promise<AnnotationResolveResult> {
  const { locator, kind } = input.annotation;
  const oldPage = locator.pdf?.page;
  const page = Number.isSafeInteger(oldPage) ? Math.min(input.pageCount - 1, Math.max(0, oldPage! - 1)) : 0;
  input.signal.throwIfAborted();
  if (kind === "bookmark" && locator.fileHash === input.hash && oldPage && oldPage <= input.pageCount)
    return { status: "exact", locator };
  const highlight = locator.text?.highlight;
  if (!highlight) return kind === "bookmark"
    ? { status: "approximate", locator: { ...locator, fileHash: input.hash, cfi: undefined, sectionIndex: page, href: String(page), pdf: { page: page + 1 } } }
    : { status: "orphaned", locator: null };
  const candidates: { score: number; exact: boolean; locator: DurtalLocator }[] = [];
  let ambiguous = false, deferred = false;
  for (const pageIndex of pdfHealingPages(page, input.pageCount)) {
    input.signal.throwIfAborted();
    const request = { fileHash: input.hash, pageIndex, signal: input.signal };
    const text = await input.provider.pdfPageText(request);
    input.signal.throwIfAborted();
    const match = matchAnnotationQuote(text.text, { ...locator.text, highlight }, { signal: input.signal });
    // A page too long for a bounded fuzzy search leaves only an exact copy
    // of the words and of the words around them elsewhere able to decide the
    // mark: one there still heals it, so a changed file's mark is not left
    // waiting (SLN-670). The words alone could be a passage that repeats,
    // with the mark's own copy on the page that was not searched.
    if (match.status === "deferred") deferred = true;
    if (match.status === "ambiguous") ambiguous = true;
    if (match.status === "found") {
      const measured = await input.provider.locatorForPdfTextOffsets({ ...request, start: match.match.start, end: match.match.end });
      input.signal.throwIfAborted();
      if (!measured) return { status: "pending", locator: null };
      // The same words, alone on their own page of the same file, are the
      // mark's place. The rectangles saved from the selection differ from the
      // measured text by a fraction of a line, so they never decide it: when
      // they did, every mark went on to scan the other pages, whose fuzzy
      // match defers, and stayed undrawn (SLN-670).
      if (locator.fileHash === input.hash && pageIndex + 1 === oldPage && match.match.passageScore === 1)
        return { status: "exact", locator: measured };
      candidates.push({ score: match.match.score, exact: match.match.score >= 1 - 1e-9, locator: measured });
      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 2) candidates.pop();
    }
    // A per-page matcher has its own bounded quantum; scanning yields between pages.
    await speechYield(input.signal);
  }
  if (ambiguous || (candidates[1] && candidates[0].score - candidates[1].score < 0.01))
    return { status: "orphaned", locator: null };
  if (candidates[0] && (!deferred || candidates[0].exact)) return { status: "healed", locator: candidates[0].locator };
  if (deferred) return { status: "pending", locator: null };
  return kind === "bookmark"
    ? { status: "approximate", locator: { ...locator, fileHash: input.hash, cfi: undefined, sectionIndex: page, href: String(page), pdf: { page: page + 1 } } }
    : { status: "orphaned", locator: null };
}
