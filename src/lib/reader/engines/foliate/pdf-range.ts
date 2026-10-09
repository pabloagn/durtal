export const PDF_RANGE_CHUNK_BYTES = 262144;
export const PDF_MAX_CONCURRENT_RANGES = 6;

export interface PdfByteRange {
  begin: number;
  end: number;
}

/** Exclusive-end transport reads split before any fetch is dispatched. */
export function* pdfRangeChunks(
  begin: number,
  end: number,
  size: number,
): Generator<PdfByteRange> {
  if (
    ![begin, end, size].every(Number.isSafeInteger) ||
    begin < 0 ||
    end < begin ||
    begin > size ||
    size < 0
  )
    throw new RangeError("Invalid PDF byte interval");
  const stop = Math.min(end, size);
  for (let from = begin; from < stop; ) {
    const to = Math.min(stop, from + PDF_RANGE_CHUNK_BYTES);
    yield { begin: from, end: to };
    from = to;
  }
}

/** Inspect headers BEFORE consuming a body; never buffer a whole-file 200. */
export function pdfRangeResponsePolicy(input: {
  range: PdfByteRange;
  size: number;
  status: number;
  contentRange: string | null;
  contentLength?: string | null;
  viaCdn: boolean;
}): "accept" | "retry-app" | "reject" {
  const { range, size, status, contentRange, contentLength, viaCdn } = input;
  if (
    ![range.begin, range.end, size].every(Number.isSafeInteger) ||
    range.begin < 0 ||
    range.end <= range.begin ||
    range.end > size ||
    range.end - range.begin > PDF_RANGE_CHUNK_BYTES
  )
    return "reject";
  if (status === 200) return viaCdn ? "retry-app" : "reject";
  if (status !== 206) return "reject";
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange ?? "");
  if (
    !match ||
    Number(match[1]) !== range.begin ||
    Number(match[2]) !== range.end - 1 ||
    Number(match[3]) !== size
  )
    return "reject";
  if (
    contentLength != null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) !== range.end - range.begin)
  )
    return "reject";
  return "accept";
}

/** Also verify decoded body length after an accepted response completes. */
export function pdfRangeBodyMatches(
  range: PdfByteRange,
  byteLength: number,
): boolean {
  return (
    Number.isSafeInteger(range.begin) &&
    Number.isSafeInteger(range.end) &&
    range.begin >= 0 &&
    range.end > range.begin &&
    range.end - range.begin <= PDF_RANGE_CHUNK_BYTES &&
    Number.isSafeInteger(byteLength) &&
    byteLength === range.end - range.begin
  );
}
