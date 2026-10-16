// @vitest-environment happy-dom
// Mounted action hook and real annotation controller/serializer. Native rendering
// and the durable transport are fixtures; this is not browser or IndexedDB proof.
import { act, createElement as h, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderBridgeProvider } from "@/components/reader/bridge";
import { useReaderAnnotations } from "@/components/reader/use-reader-annotations";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { ReaderEngine } from "@/lib/reader/engine";
import type { AnnotationBookState, AnnotationTransport, DurableAnnotationOperation } from "@/lib/reader/sync/annotation-transport";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import { fakeEngine } from "./fixtures/fake-engine";
import { id, locator } from "./fixtures/annotation";

const runtime = vi.hoisted(() => ({ transport: null as unknown }));
vi.mock("@/lib/reader/offline/runtime", () => ({ getReaderRuntime: async () => ({}) }));
vi.mock("@/lib/reader/sync/annotation-codec", () => ({ sharedAnnotationTransport: () => runtime.transport }));
vi.mock("next/font/google", () => ({ EB_Garamond: () => ({ variable: "font-prose" }) }));
let root: Root, host: HTMLElement, book: HTMLParagraphElement, bridge: ReaderBridgeController;
let engine: ReturnType<typeof fakeEngine>["engine"], enqueued: DurableAnnotationOperation[];
let release: (() => void) | null, hold: Promise<void> | null;
const word = { text: "Table", locator, rect: { left: 0, right: 100, top: 0, bottom: 20 }, keyboard: false };
const paragraph = "Table by the door, where the widow waited.";
const paragraphLocator = { ...locator, cfi: locator.cfi.replace("/1:16)", "/1:43)"),
  text: { ...locator.text, highlight: paragraph } };
function Actions({ owner }: { owner: ReaderBridgeController }) {
  useLayoutEffect(() => owner.registerSelectionCapture(() => {
    const details = engine.selectionDetails();
    if (!details) return null;
    const text = details.locator.text?.highlight ?? details.text.trim();
    if (!text) return null;
    return { selection: { text, locator: details.locator,
      fileId: id(3), chapter: null, percent: 44 }, clear: () => (engine as ReaderEngine).clearSelection(details) };
  }), [owner]);
  const annotations = useReaderAnnotations({ book: { id: id(2), title: "Selection test", authors: [] },
    fileId: id(3), deviceId: id(4), engine, painted: true, bridge: owner, selection: word,
    locator, palette: QUIET_GLASS_ANNOTATION_PALETTE, onJump: async () => true, onNotice: vi.fn() });
  return h("div", null, annotations.markingActions, annotations.overlays);
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  enqueued = []; hold = null; release = null;
  let current: AnnotationBookState = { annotations: [], pending: [], cursor: null };
  const transport: AnnotationTransport = {
    readBook: async () => structuredClone(current),
    transactBook: async (_id, reduce) => { current = reduce(current); return structuredClone(current); },
    subscribe: () => () => {}, requestReplay: async () => {},
    enqueue: async operation => {
      if (hold) await hold;
      enqueued.push(structuredClone(operation));
      current = { ...current, pending: [...current.pending, { ...operation.local,
        transportIdentity: { fileId: operation.fileId, expectedDeviceId: operation.expectedDeviceId, createdAt: operation.createdAt } }] };
    },
  };
  runtime.transport = transport;
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  engine = fakeEngine().engine;
  book = document.createElement("p"); book.textContent = paragraph; document.body.append(book);
  engine.selectionDetails.mockImplementation(() => {
    const text = document.getSelection()?.toString();
    if (!text) return null;
    return { text, locator: text === paragraph ? paragraphLocator : locator,
      lang: "en", sentence: paragraph, rect: new DOMRectReadOnly(0, 0, 100, 20) };
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => {
    root.render(h(ReaderBridgeProvider, { context: { ebookId: id(2), fileId: id(3), format: "epub",
      locator, selection: { text: "Table", locator, fileId: id(3), chapter: null, percent: 44 }, chapter: null, percent: 44 },
      plugins: [], children: owner => { bridge = owner; return h(Actions, { owner }); } }));
  });
  expect(host.querySelector('[aria-label="Highlight in ochre"]')).not.toBeNull();
});
afterEach(() => { act(() => root.unmount()); document.getSelection()?.removeAllRanges(); book.remove(); host.remove(); vi.restoreAllMocks(); });
async function saveNote(text: string) {
  const area = document.querySelector<HTMLTextAreaElement>("dialog textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(item => item.textContent === "Save note")!.click();
  });
}
function selectParagraph() {
  const range = document.createRange(); range.selectNodeContents(book);
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
}
describe("annotation action-time selection", () => {
  it.each(["highlight", "note"] as const)("enqueues paragraph text and its locator from %s despite the published word, using the original durable identity", async action => {
    selectParagraph();
    await act(async () => {
      const button = action === "highlight" ? host.querySelector<HTMLButtonElement>('[aria-label="Highlight in ochre"]')! :
        host.querySelector<HTMLButtonElement>('[aria-label="Add a note"]')!;
      button.click();
    });
    if (action === "note") {
      // Note makes its mark only when the note is saved (SLN-682)
      expect(enqueued).toHaveLength(0);
      expect(document.querySelector("[data-note-passage]")?.textContent).toBe(paragraph);
      await saveNote("By the door.");
    }
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ ebookId: id(2), fileId: id(3), expectedDeviceId: id(4), revision: 1,
      local: { mutation: { text: paragraph, locator: paragraphLocator, fileId: id(3), note: action === "note" ? "By the door." : null } } });
    expect(JSON.parse(enqueued[0].body)).toMatchObject({ upserts: [{ text: paragraph, locator: paragraphLocator }], deletes: [] });
    expect(engine.clearSelection).toHaveBeenCalledOnce();
  });
  it("leaves no mark when a new note is cancelled (SLN-682)", async () => {
    selectParagraph();
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Add a note"]')!.click(); });
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(item => item.textContent === "Cancel")!;
    const save = [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(item => item.textContent === "Save note")!;
    expect(save.disabled).toBe(true);
    await act(async () => { cancel.click(); });
    expect(document.querySelector("dialog")).toBeNull();
    expect(enqueued).toHaveLength(0);
  });
  it("changes the mark already on the words rather than marking them twice (SLN-682)", async () => {
    selectParagraph();
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Highlight in ochre"]')!.click(); });
    selectParagraph();
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Highlight in sage"]')!.click(); });
    expect(enqueued).toHaveLength(2);
    expect(enqueued[1].local.mutation).toMatchObject({ op: "put", id: enqueued[0].local.mutation.id, color: "sage", style: "highlight" });
    selectParagraph();
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Underline")!.click(); });
    expect(enqueued).toHaveLength(3);
    expect(enqueued[2].local.mutation).toMatchObject({ id: enqueued[0].local.mutation.id, color: "ochre", style: "underline" });
    // A note on the same words opens the mark's own note
    selectParagraph();
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Add a note"]')!.click(); });
    expect(document.querySelector("dialog")?.textContent).not.toContain("Save note");
    expect(document.querySelector("[data-note-passage]")?.textContent).toBe(paragraph);
  });
  it("underlines a fresh selection", async () => {
    selectParagraph();
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Underline")!.click(); });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].local.mutation).toMatchObject({ op: "put", kind: "highlight", style: "underline", color: "ochre", text: paragraph });
  });
  it("does not enqueue the stale word when the native range has collapsed", async () => {
    document.getSelection()!.removeAllRanges();
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Highlight in ochre"]')!.click(); });
    expect(enqueued).toHaveLength(0); expect(engine.clearSelection).not.toHaveBeenCalled();
  });
  it("retains the captured durable write but never clears after the reader generation is revoked", async () => {
    selectParagraph(); hold = new Promise<void>(done => { release = done; });
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Highlight in ochre"]')!.click(); });
    expect(enqueued).toHaveLength(0);
    bridge.destroy(); bridge.start();
    await act(async () => { release!(); });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].local.mutation).toMatchObject({ text: paragraph, locator: paragraphLocator });
    expect(engine.clearSelection).not.toHaveBeenCalled();
  });
});
