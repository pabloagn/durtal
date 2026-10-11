import type { AnnotationResolveResult, DurtalLocator } from "../../engine";
import type { PdfTextProvider } from "./pdf-text-provider";
import { matchAnnotationQuote } from "./annotation-anchor";
import { pdfHealingPages, validPdfRect } from "./pdf-geometry";
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
  const candidates: { score: number; locator: DurtalLocator }[] = [];
  let ambiguous = false;
  for (const pageIndex of pdfHealingPages(page, input.pageCount)) {
    input.signal.throwIfAborted();
    const request = { fileHash: input.hash, pageIndex, signal: input.signal };
    const text = await input.provider.pdfPageText(request);
    input.signal.throwIfAborted();
    const match = matchAnnotationQuote(text.text, { ...locator.text, highlight }, { signal: input.signal });
    if (match.status === "deferred") return { status: "pending", locator: null };
    if (match.status === "ambiguous") ambiguous = true;
    if (match.status === "found") {
      const measured = await input.provider.locatorForPdfTextOffsets({ ...request, start: match.match.start, end: match.match.end });
      input.signal.throwIfAborted();
      if (!measured) return { status: "pending", locator: null };
      const stored = locator.pdf?.rects;
      const current = measured.pdf?.rects;
      const exactGeometry = stored?.length && current?.length === stored.length &&
        stored.every((rect, index) => validPdfRect(rect) && rect.every((n, at) => Math.abs(n - current[index][at]) <= 0.02));
      if (locator.fileHash === input.hash && pageIndex + 1 === oldPage && match.match.passageScore === 1 && exactGeometry)
        return { status: "exact", locator: measured };
      candidates.push({ score: match.match.score, locator: measured });
      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 2) candidates.pop();
    }
    // A per-page matcher has its own bounded quantum; scanning yields between pages.
    await speechYield(input.signal);
  }
  if (ambiguous || (candidates[1] && candidates[0].score - candidates[1].score < 0.01))
    return { status: "orphaned", locator: null };
  if (candidates[0]) return { status: "healed", locator: candidates[0].locator };
  return kind === "bookmark"
    ? { status: "approximate", locator: { ...locator, fileHash: input.hash, cfi: undefined, sectionIndex: page, href: String(page), pdf: { page: page + 1 } } }
    : { status: "orphaned", locator: null };
}
