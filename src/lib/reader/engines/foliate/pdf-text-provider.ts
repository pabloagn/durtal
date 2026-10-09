import type { DurtalLocator, PdfPageText, PdfTextPageRequest } from "@/lib/reader/engine";
import type { PdfSession } from "./pdf-session";

export interface PdfTextProvider {
  pdfPageText(request: PdfTextPageRequest): Promise<PdfPageText>;
  locatorForPdfTextOffsets(request: PdfTextPageRequest & {
    start: number;
    end: number;
  }): Promise<DurtalLocator | null>;
}

/** Bind only the actual opened document and its exact adapter-owned layer CSS. */
export function bindPdfTextProvider(
  session: Pick<PdfSession, "pdfPageText" | "locatorForPdfTextOffsets">,
  css: string,
): PdfTextProvider {
  return Object.freeze({
    pdfPageText: (request: PdfTextPageRequest) => session.pdfPageText(request),
    locatorForPdfTextOffsets: (request: PdfTextPageRequest & { start: number; end: number }) =>
      session.locatorForPdfTextOffsets(request, css),
  });
}
