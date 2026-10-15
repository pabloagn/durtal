import { describe, expect, it, vi } from "vitest";
import type { DurtalLocator, PdfTextPageRequest } from "@/lib/reader/engine";
import type { PdfTextProvider } from "@/lib/reader/engines/foliate/pdf-text-provider";
import { resolvePdfAnnotation } from "@/lib/reader/engines/foliate/pdf-annotation-resolver";
import { preparePdfSpeech } from "@/lib/reader/engines/foliate/pdf-speech";
import { initialSpeechPlayer, transitionSpeechPlayer, type SpeechPreparation } from "@/lib/reader/speech/player";
import { sameLocation } from "@/lib/reader/navigation";

const hash = "a".repeat(64);
const anchor = (page = 0, text = "First sentence."): DurtalLocator => ({ v: 1, fileHash: hash,
  href: String(page), sectionIndex: page, progression: 0.1, totalProgression: page / 3,
  pdf: { page: page + 1, rects: [[10, 20, 100, 30]] }, text: { highlight: text } });
/** Consumer-contract fixtures only; these do not certify native PDF geometry. */
function provider(pages: string[], measured = true): PdfTextProvider {
  return {
    pdfPageText: vi.fn(async (request: PdfTextPageRequest) => { request.signal.throwIfAborted(); return { fileHash: hash, pageIndex: request.pageIndex, pageLabel: String(request.pageIndex + 1), text: pages[request.pageIndex] }; }),
    locatorForPdfTextOffsets: vi.fn(async (request: PdfTextPageRequest & { start: number; end: number }) => { request.signal.throwIfAborted(); return measured ? anchor(request.pageIndex, pages[request.pageIndex].slice(request.start, request.end)) : null; }),
  };
}
const owner = () => new AbortController();
describe("opened PDF annotation consumers", () => {
  it("returns exact only when text and stored user-unit ranges verify", async () => {
    const p = provider(["First sentence.", "Other page."]);
    const result = await resolvePdfAnnotation({ provider: p, hash, pageCount: 2, annotation: { kind: "highlight", locator: anchor() }, signal: owner().signal });
    expect(result.status).toBe("exact"); expect(p.locatorForPdfTextOffsets).toHaveBeenCalledWith(expect.objectContaining({ start: 0, end: 15, fileHash: hash }));
  });
  it("is exact on its own page when the saved rectangles differ slightly, without scanning other pages (SLN-670)", async () => {
    const p = provider(["First sentence.", "Other page."]);
    const saved = { ...anchor(), pdf: { page: 1, rects: [[10.06, 20.67, 99.94, 29.2]] as [number, number, number, number][] } };
    const result = await resolvePdfAnnotation({ provider: p, hash, pageCount: 2, annotation: { kind: "highlight", locator: saved }, signal: owner().signal });
    expect(result.status).toBe("exact");
    expect(result.locator?.pdf?.rects).toEqual([[10, 20, 100, 30]]);
    expect(p.pdfPageText).toHaveBeenCalledTimes(1);
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
  it("heals a replaced file by an exact quote while a long page defers its fuzzy search (SLN-670)", async () => {
    const long = "word ".repeat(2000);
    const result = await resolvePdfAnnotation({ provider: provider([long, "First sentence."]), hash, pageCount: 2, annotation: { kind: "highlight", locator: { ...anchor(), fileHash: "b".repeat(64) } }, signal: owner().signal });
    expect(result.status).toBe("healed"); expect(result.locator?.pdf?.page).toBe(2);
  });
  it("keeps waiting when the words repeat elsewhere but the words around them differ, and another page deferred", async () => {
    const long = "word ".repeat(2000);
    const quoted = { ...anchor(), fileHash: "b".repeat(64), text: { before: "The orchard at dusk. ", highlight: "First sentence." } };
    const result = await resolvePdfAnnotation({ provider: provider([long, "A different page. First sentence."]), hash, pageCount: 2, annotation: { kind: "highlight", locator: quoted }, signal: owner().signal });
    expect(result).toEqual({ status: "pending", locator: null });
  });
  it("keeps waiting when only a near quote was found and another page deferred", async () => {
    const long = "word ".repeat(2000);
    const result = await resolvePdfAnnotation({ provider: provider([long, "First sentenze."]), hash, pageCount: 2, annotation: { kind: "highlight", locator: { ...anchor(), fileHash: "b".repeat(64) } }, signal: owner().signal });
    expect(result).toEqual({ status: "pending", locator: null });
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

describe("PDF Previous through the real speech reducer", () => {
  it("moves backwards consecutively through four sentences and the preceding-page boundary", async () => {
    const pages = ["Earlier sentence.","First sentence. Second sentence. Third sentence. Fourth sentence."];
    const p = provider(pages);
    let state = initialSpeechPlayer();
    const prepare = async (target: SpeechPreparation) => {
      const result = await preparePdfSpeech({ provider: p, fileHash: hash, pageCount: 2, language: "en", target, visible: anchor(1), signal: owner().signal, isVisible: () => true });
      expect(result.current).not.toBeNull();
      expect(result.previous?.text).not.toBe(result.current!.text);
      state = transitionSpeechPlayer(state,{ kind: "prepared", generation: state.generation, ...result, current: result.current! }).state;
    };
    const target: SpeechPreparation = { kind: "from", from: anchor(1,"Fourth sentence.") };
    state = transitionSpeechPlayer(state,{ kind: "prepare", target }).state; await prepare(target);
    for (const expected of ["Third sentence.","Second sentence.","First sentence.","Earlier sentence."]) {
      const transition = transitionSpeechPlayer(state,{ kind: "skip", direction: "previous" }); state = transition.state;
      const command = transition.commands.find(item => item.kind === "prepare");
      if (command?.kind === "prepare") await prepare(command.target);
      expect(state.current?.text).toBe(expected); expect(state.previous?.text).not.toBe(expected);
    }
    const result = await preparePdfSpeech({ provider: p, fileHash: hash, pageCount: 2, language: "en", target: { kind: "adjacent", direction: "previous", locator: state.current!.locator }, visible: anchor(), signal: owner().signal, isVisible: () => true });
    expect(result.current).toBeNull(); expect(result.previous).toBeNull();
  });
});
