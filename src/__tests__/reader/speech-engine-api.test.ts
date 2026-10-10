import { describe, expect, it, vi } from "vitest";
import { createFoliateSpeech } from "@/lib/reader/engines/foliate/speech";
import type { SpeechSegment } from "@/lib/reader/speech/player";
const segment = (sectionIndex: number, cfi: string): SpeechSegment => ({
  text: "Actual plain text.", lang: "fr",
  locator: { v: 1, fileHash: "a".repeat(64), sectionIndex, href: `section${sectionIndex}`, cfi, progression: 0, totalProgression: 0 },
});
const result = (current: SpeechSegment | null) => ({ current, previous: null, next: null });
describe("engine speech enumeration ownership", () => {
  it("enumerates exact records across sections and requests the successor only when consumed", async () => {
    const first = segment(0, "first"), next = segment(1, "next");
    const prepare = vi.fn().mockResolvedValueOnce(result(first)).mockResolvedValueOnce(result(next)).mockResolvedValueOnce(result(null));
    const speech = createFoliateSpeech({ available: () => true, prepare });
    const signal = new AbortController().signal;
    const iterator = speech.segments(first.locator, { signal })[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: first, done: false });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenNthCalledWith(1, { target: { kind: "from", from: first.locator }, signal });
    expect(await iterator.next()).toEqual({ value: next, done: false });
    expect(prepare).toHaveBeenNthCalledWith(2, { target: { kind: "adjacent", locator: first.locator, direction: "next" }, signal });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
  it("rejects canceled enumeration before work and after a yielded sentence", async () => {
    const owner = new AbortController(), prepare = vi.fn().mockResolvedValue(result(segment(0, "first")));
    const speech = createFoliateSpeech({ available: () => true, prepare });
    owner.abort();
    await expect(speech.segments("visible", { signal: owner.signal })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ name: "AbortError" });
    expect(prepare).not.toHaveBeenCalled();
    const active = new AbortController();
    const iterator = speech.segments("visible", { signal: active.signal })[Symbol.asyncIterator]();
    await iterator.next();
    active.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("does no extraction for a closed engine and stops when it closes while suspended", async () => {
    let available = false;
    const prepare = vi.fn().mockResolvedValue(result(segment(0, "first")));
    const speech = createFoliateSpeech({ available: () => available, prepare });
    expect(await speech.segments("visible")[Symbol.asyncIterator]().next()).toEqual({ value: undefined, done: true });
    expect(prepare).not.toHaveBeenCalled();
    available = true;
    const iterator = speech.segments("visible")[Symbol.asyncIterator]();
    await iterator.next();
    available = false;
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("surfaces a non-advancing extractor rather than yielding the same sentence forever", async () => {
    const prepare = vi.fn().mockResolvedValue(result(segment(0, "first")));
    const iterator = createFoliateSpeech({ available: () => true, prepare }).segments("visible")[Symbol.asyncIterator]();
    await iterator.next();
    await expect(iterator.next()).rejects.toThrow("did not advance");
  });
});
