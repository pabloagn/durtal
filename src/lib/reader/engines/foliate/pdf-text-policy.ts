export interface PdfTextEvidence {
  pageCount: number;
  /** Page indices inspected from actual PDF text content, not rendered pixels. */
  inspected: readonly number[];
  withText: readonly number[];
}
export type PdfTextKnowledge =
  | "unknown"
  | "sampled-no-text"
  | "has-text"
  | "confirmed-no-text";

export function initialPdfTextEvidence(pageCount: number): PdfTextEvidence {
  if (!Number.isSafeInteger(pageCount) || pageCount <= 0)
    throw new RangeError("Invalid PDF page count");
  return { pageCount, inspected: [], withText: [] };
}

export function recordPdfPageText(
  evidence: PdfTextEvidence,
  pageIndex: number,
  hasText: boolean,
): PdfTextEvidence {
  if (
    !Number.isSafeInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= evidence.pageCount
  )
    throw new RangeError("Invalid PDF text page");
  const inspected = evidence.inspected.includes(pageIndex)
    ? [...evidence.inspected]
    : [...evidence.inspected, pageIndex];
  const withText = evidence.withText.filter((index) => index !== pageIndex);
  if (hasText) withText.push(pageIndex);
  return { pageCount: evidence.pageCount, inspected, withText };
}

export function pdfTextKnowledge(evidence: PdfTextEvidence): PdfTextKnowledge {
  if (evidence.withText.length) return "has-text";
  if (evidence.inspected.length === evidence.pageCount)
    return "confirmed-no-text";
  return evidence.inspected.length ? "sampled-no-text" : "unknown";
}

/** Empty samples never switch off whole-document discovery or speech. */
export function pdfTextCapabilities(
  evidence: PdfTextEvidence,
  currentPageHasText: boolean | undefined,
): {
  search: boolean;
  selection: boolean;
  tts: boolean;
} {
  const absent =
    currentPageHasText !== true &&
    pdfTextKnowledge(evidence) === "confirmed-no-text";
  return {
    search: !absent,
    tts: !absent,
    selection: currentPageHasText === true,
  };
}

/** At most five distributed idle probes; no whole-file classification at open. */
export function pdfTextSamplePages(pageCount: number): number[] {
  initialPdfTextEvidence(pageCount);
  const count = Math.min(5, pageCount);
  return Array.from({ length: count }, (_, i) =>
    count === 1 ? 0 : Math.floor((i * (pageCount - 1)) / (count - 1)),
  );
}
