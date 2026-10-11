import { describe, expect, it, vi } from "vitest";
import type { PdfPageText, PdfTextPageRequest } from "@/lib/reader/engine";
import { bindPdfTextProvider } from "@/lib/reader/engines/foliate/pdf-text-provider";

describe("actual-session PDF text binding", () => {
  it("preserves the request, receiver, signal and exact UTF-16 text", async () => {
    const request: PdfTextPageRequest = {
      fileHash: "a".repeat(64), pageIndex: 3, signal: new AbortController().signal,
    };
    const result: PdfPageText = { ...request, pageLabel: "iv", text: "A\ud83d\ude00\ufb03\nB" };
    const session = {
      async pdfPageText(input: PdfTextPageRequest) {
        expect(this).toBe(session);
        expect(input).toBe(request);
        return result;
      },
      locatorForPdfTextOffsets: vi.fn(async () => null),
    };
    const provider = bindPdfTextProvider(session, "exact installed CSS");
    expect(Object.isFrozen(provider)).toBe(true);
    expect(await provider.pdfPageText(request)).toBe(result);
  });

  it("forwards unchanged offsets and exact CSS without inventing geometry", async () => {
    const request = { fileHash: "b".repeat(64), pageIndex: 0, start: 1, end: 4, signal: new AbortController().signal };
    const css = ".textLayer { --min-font-size: 1; }";
    const session = {
      pdfPageText: vi.fn(),
      async locatorForPdfTextOffsets(input: typeof request, styles: string) {
        expect(this).toBe(session);
        expect(input).toBe(request);
        expect(styles).toBe(css);
        return null;
      },
    };
    expect(await bindPdfTextProvider(session, css).locatorForPdfTextOffsets(request)).toBeNull();
  });

  it("preserves owner cancellation rejection from the session", async () => {
    const owner = new AbortController();
    const error = new DOMException("owner left", "AbortError");
    owner.abort(error);
    const session = {
      async pdfPageText(request: PdfTextPageRequest): Promise<PdfPageText> {
        request.signal.throwIfAborted();
        throw new Error("unreachable");
      },
      locatorForPdfTextOffsets: vi.fn(async () => null),
    };
    await expect(bindPdfTextProvider(session, "css").pdfPageText({ fileHash: "c".repeat(64), pageIndex: 0, signal: owner.signal })).rejects.toBe(error);
  });
});
