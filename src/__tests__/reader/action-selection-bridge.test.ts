// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createReaderBridge } from "@/lib/reader/bridge-state";
import type { ReaderSelection } from "@/lib/reader/events";
import { locator } from "./fixtures/annotation";

const paragraph: ReaderSelection = { text: "Table by the door, where the widow waited.",
  locator: { ...locator, cfi: "epubcfi(paragraph)" }, fileId: "epub", chapter: null, percent: 44 };
function fixture(requiredControllerIds: string[] = []) {
  return createReaderBridge({ ebookId: "book", fileId: "epub", format: "epub", locator: null,
    percent: null, chapter: null, selection: { ...paragraph, text: "Table" } }, { requiredControllerIds });
}
describe("action selection admission", () => {
  it("has no published-selection fallback, forwards the origin and isolates the captured locator", () => {
    const bridge = fixture(), clear = vi.fn(); bridge.start();
    expect(bridge.captureSelection()).toBeNull();
    const capture = vi.fn(() => ({ selection: paragraph, clear })); bridge.registerSelectionCapture(capture);
    const value = bridge.captureSelection(document)!;
    expect(capture).toHaveBeenCalledExactlyOnceWith(document);
    expect(value.text).toBe(paragraph.text);
    value.locator.cfi = "caller edit";
    expect(paragraph.locator.cfi).toBe("epubcfi(paragraph)");
    bridge.clearCapturedSelection(value); expect(clear).toHaveBeenCalledOnce();
    bridge.clearCapturedSelection(value); expect(clear).toHaveBeenCalledOnce(); bridge.destroy();
  });
  it("rejects wrong-file and collapsed native selections despite a published word", () => {
    const bridge = fixture(); bridge.start();
    bridge.registerSelectionCapture(() => ({ selection: { ...paragraph, fileId: "other" }, clear() {} }));
    expect(bridge.captureSelection()).toBeNull();
    bridge.registerSelectionCapture(() => null); expect(bridge.captureSelection()).toBeNull(); bridge.destroy();
  });
  it("revokes a pending action on controller replacement and never clears a later capture owner", () => {
    const bridge = fixture(["tracker"]), clear = vi.fn();
    const handlers = { activity() {}, location() {}, end() {}, selection() {} };
    bridge.start();
    const remove = bridge.installController("tracker", handlers);
    const oldOff = bridge.registerSelectionCapture(() => ({ selection: paragraph, clear }));
    const value = bridge.captureSelection()!;
    remove(); expect(bridge.captureSelection()).toBeNull();
    const removeNew = bridge.installController("tracker", handlers);
    expect(bridge.isSelectionCaptureCurrent(value)).toBe(false);
    bridge.clearCapturedSelection(value); expect(clear).not.toHaveBeenCalled();
    bridge.registerSelectionCapture(() => ({ selection: paragraph, clear })); oldOff();
    expect(bridge.captureSelection()?.text).toBe(paragraph.text);
    const current = bridge.captureSelection()!;
    bridge.destroy(); bridge.start();
    expect(bridge.isSelectionCaptureCurrent(current)).toBe(false);
    expect(bridge.captureSelection()).toBeNull(); removeNew(); bridge.destroy();
  });
});
