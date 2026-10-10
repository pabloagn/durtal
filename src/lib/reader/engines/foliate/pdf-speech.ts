import type { DurtalLocator } from "../../engine";
import type { SpeechPreparation, SpeechSegment } from "../../speech/player";
import { speechLanguage } from "../../speech/voices";
import { speechYield } from "../../speech/dom-sentences";
import { matchAnnotationQuote } from "./annotation-anchor";
import type { PdfTextProvider } from "./pdf-text-provider";

/** One page at a time; sentence offsets are in the producer's original UTF-16 text. */
export async function preparePdfSpeech(input: {
  provider: PdfTextProvider; fileHash: string; pageCount: number; language: string | null;
  target: SpeechPreparation; visible: DurtalLocator | null; signal: AbortSignal;
  /** Tests actual transformed page geometry against the live reading viewport. */
  isVisible(locator: DurtalLocator): boolean;
}) {
  const empty = { current: null, previous: null, next: null };
  const requested = input.target.kind === "adjacent" ? input.target.locator : input.target.from;
  const locator = requested === "visible" ? input.visible : requested;
  if (!locator || (requested !== "visible" && locator.fileHash !== input.fileHash))
    throw new Error("That speech place belongs to another PDF.");
  const initialPage = (locator.pdf?.page ?? locator.sectionIndex + 1) - 1;
  if (!Number.isSafeInteger(initialPage) || initialPage < 0 || initialPage >= input.pageCount) return empty;
  const language = speechLanguage(input.language) ?? "und";
  const segmenter = new Intl.Segmenter(language === "und" ? undefined : language, { granularity: "sentence" });
  let previous: SpeechSegment | null = null, current: SpeechSegment | null = null, next: SpeechSegment | null = null;
  let anchorStart: number | null = null, matched = requested === "visible";
  const pageSegments = async function* (pageIndex: number) {
    input.signal.throwIfAborted();
    const request = { fileHash: input.fileHash, pageIndex, signal: input.signal };
    const page = await input.provider.pdfPageText(request);
    input.signal.throwIfAborted();
    if (pageIndex === initialPage && requested !== "visible") {
      const quote = locator.text?.highlight;
      if (!quote) throw new Error("This PDF speech place has no exact text anchor.");
      const found = matchAnnotationQuote(page.text, { ...locator.text, highlight: quote }, { signal: input.signal });
      if (found.status !== "found" || found.match.passageScore !== 1)
        throw new Error("The selected PDF sentence could not be located uniquely.");
      anchorStart = found.match.start;
    }
    for (const span of segmenter.segment(page.text)) {
      input.signal.throwIfAborted();
      const leading = span.segment.length - span.segment.trimStart().length;
      const end = span.index + span.segment.trimEnd().length;
      const start = span.index + leading;
      if (end <= start) continue;
      const measured = await input.provider.locatorForPdfTextOffsets({ ...request, start, end });
      input.signal.throwIfAborted();
      if (!measured) throw new Error("The PDF sentence has no measured text range.");
      yield { segment: { text: span.segment.trim().replace(/\s+/g, " "), lang: language, locator: measured }, start, end };
      await speechYield(input.signal);
    }
  };
  for (let pageIndex = initialPage; pageIndex < input.pageCount; pageIndex++) {
    for await (const item of pageSegments(pageIndex)) {
      if (current) { next = item.segment; break; }
      const reached = pageIndex > initialPage || (requested === "visible"
        ? input.isVisible(item.segment.locator)
        : anchorStart !== null && item.end > anchorStart);
      if (!reached) { previous = item.segment; continue; }
      if (input.target.kind === "adjacent" && input.target.direction === "previous") {
        current = previous; previous = null; next = item.segment; break;
      }
      if (input.target.kind === "adjacent" && !matched) { matched = true; previous = item.segment; continue; }
      current = item.segment;
    }
    if (next || (input.target.kind === "adjacent" && input.target.direction === "previous")) break;
    if (requested === "visible" && !current) return empty;
  }
  const movingPrevious = input.target.kind === "adjacent" && input.target.direction === "previous";
  // A same-page Previous must prepare its own predecessor next time, rather
  // than caching the returned sentence or skipping to the preceding page.
  if (!previous && initialPage > 0 && (movingPrevious ? !current : !!current)) {
    let last: SpeechSegment | null = null;
    for (let page = initialPage - 1; page >= 0 && !last; page--)
      for await (const item of pageSegments(page)) last = item.segment;
    if (!current && input.target.kind === "adjacent" && input.target.direction === "previous") current = last;
    else previous = last;
  }
  return { current, previous, next };
}
