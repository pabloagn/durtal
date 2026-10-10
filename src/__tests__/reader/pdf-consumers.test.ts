import { describe, expect, it, vi } from "vitest";
import type { DurtalLocator } from "@/lib/reader/engine";
import type { PdfTextProvider } from "@/lib/reader/engines/foliate/pdf-text-provider";
import { resolvePdfAnnotation } from "@/lib/reader/engines/foliate/pdf-annotation-resolver";
import { preparePdfSpeech } from "@/lib/reader/engines/foliate/pdf-speech";
import { sameLocation } from "@/lib/reader/navigation";

const hash = "a".repeat(64);
const anchor = (page = 0, text = "First sentence."): DurtalLocator => ({ v: 1, fileHash: hash,
  href: String(page), sectionIndex: page, progression: 0.1, totalProgression: page / 3,
  pdf: { page: page + 1, rects: [[10, 20, 100, 30]] }, text: { highlight: text } });
/** Consumer-contract fixtures only; these do not certify native PDF geometry. */
function provider(pages: string[], measured = true): PdfTextProvider {
  return {
    pdfPageText: vi.fn(async request => { request.signal.throwIfAborted(); return { fileHash: hash, pageIndex: request.pageIndex, pageLabel: String(request.pageIndex + 1), text: pages[request.pageIndex] }; }),
    locatorForPdfTextOffsets: vi.fn(async request => { request.signal.throwIfAborted(); return measured ? anchor(request.pageIndex, pages[request.pageIndex].slice(request.start, request.end)) : null; }),
  };
}
const owner = () => new AbortController();
describe("opened PDF annotation consumers", () => {
  it("returns exact only when text and stored user-unit ranges verify", async () => {
    const p = provider(["First sentence.", "Other page."]);
    const result = await resolvePdfAnnotation({ provider: p, hash, pageCount: 2, annotation: { kind: "highlight", locator: anchor() }, signal: owner().signal });
    expect(result.status).toBe("exact"); expect(p.locatorForPdfTextOffsets).toHaveBeenCalledWith(expect.objectContaining({ start: 0, end: 15, fileHash: hash }));
  });
  it("never fills a repeated ambiguous passage or falls back to a fraction", async () => {
    const result = await resolvePdfAnnotation({ provider: provider(["Repeated. Repeated."]), hash, pageCount: 1, annotation: { kind: "highlight", locator: anchor(0, "Repeated.") }, signal: owner().signal });
    expect(result).toEqual({ status: "orphaned", locator: null });
  });
  it("retains pending when the actual measurement is absent", async () => {
    expect(await resolvePdfAnnotation({ provider: provider(["First sentence."], false), hash, pageCount: 1, annotation: { kind: "highlight", locator: anchor() }, signal: owner().signal })).toEqual({ status: "pending", locator: null });
  });
  it("heals a replaced file by the unique real page quote", async () => {
    const result = await resolvePdfAnnotation({ provider: provider(["Other page.", "First sentence."]), hash, pageCount: 2, annotation: { kind: "highlight", locator: { ...anchor(), fileHash: "b".repeat(64) } }, signal: owner().signal });
    expect(result.status).toBe("healed"); expect(result.locator?.pdf?.page).toBe(2);
  });
  it("honors an already aborted owner without reading a page", async () => {
    const abort = owner(); abort.abort(); const p = provider(["First sentence."]);
    await expect(resolvePdfAnnotation({ provider: p, hash, pageCount: 1, annotation: { kind: "highlight", locator: anchor() }, signal: abort.signal })).rejects.toHaveProperty("name", "AbortError");
    expect(p.pdfPageText).not.toHaveBeenCalled();
  });
});
describe("PDF speech original offsets", () => {
  it("keeps UTF-16 sentence offsets including a surrogate pair and crosses pages", async () => {
    const p = provider(["A😀 sentence. Second sentence.", "Third sentence."]);
    const result = await preparePdfSpeech({ provider: p, fileHash: hash, pageCount: 2, language: "en", target: { kind: "adjacent", direction: "next", locator: anchor(0, "Second sentence.") }, visible: anchor(), signal: owner().signal, isVisible: () => true });
    expect(result.current?.text).toBe("Third sentence.");
    expect(p.locatorForPdfTextOffsets).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 0, start: 14, end: 30 }));
  });
  it("starts only at an actually visible measured sentence", async () => {
    const result = await preparePdfSpeech({ provider: provider(["First sentence. Second sentence."]), fileHash: hash, pageCount: 1, language: "en", target: { kind: "from", from: "visible" }, visible: anchor(), signal: owner().signal, isVisible: locator => locator.text?.highlight === "Second sentence." });
    expect(result.current?.text).toBe("Second sentence.");
  });
  it("does not create speech geometry when the producer returned null", async () => {
    await expect(preparePdfSpeech({ provider: provider(["First sentence."], false), fileHash: hash, pageCount: 1, language: "en", target: { kind: "from", from: "visible" }, visible: anchor(), signal: owner().signal, isVisible: () => true })).rejects.toThrow("measured text range");
  });
  it("gets previous across an empty intervening page", async () => {
    const result = await preparePdfSpeech({ provider: provider(["First sentence.", "", "Last sentence."]), fileHash: hash, pageCount: 3, language: "en", target: { kind: "adjacent", direction: "previous", locator: anchor(2, "Last sentence.") }, visible: anchor(2), signal: owner().signal, isVisible: () => true });
    expect(result.current?.text).toBe("First sentence.");
  });
  it("distinct measured sentences on one page remain distinct navigation places", () => {
    expect(sameLocation(anchor(), { ...anchor(), pdf: { page: 1, rects: [[10, 40, 100, 50]] } })).toBe(false);
  });
});
