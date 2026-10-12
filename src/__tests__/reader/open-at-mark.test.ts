// @vitest-environment happy-dom
// /ebooks/highlights opens the reader with ?at=<mark>: the mounted hook with the
// real annotation controller; native rendering and the transport are fixtures.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderBridgeProvider } from "@/components/reader/bridge";
import { useReaderAnnotations } from "@/components/reader/use-reader-annotations";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { AnnotationBookState, AnnotationTransport } from "@/lib/reader/sync/annotation-transport";
import type { DurtalLocator, ReaderEngine } from "@/lib/reader/engine";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import { fakeEngine } from "./fixtures/fake-engine";
import { annotation, at, id, locator } from "./fixtures/annotation";

const runtime = vi.hoisted(() => ({ transport: null as unknown }));
vi.mock("@/lib/reader/offline/runtime", () => ({ getReaderRuntime: async () => ({}) }));
vi.mock("@/lib/reader/sync/annotation-codec", () => ({ sharedAnnotationTransport: () => runtime.transport }));
vi.mock("next/font/google", () => ({ EB_Garamond: () => ({ variable: "font-prose" }) }));

let root: Root, host: HTMLElement;
let onJump: ReturnType<typeof vi.fn<(at: DurtalLocator) => Promise<boolean>>>, onNotice: ReturnType<typeof vi.fn<(message: string) => void>>;
const unplaced = "That mark could not be placed in this file. It is still listed under Highlights and notes.";

function Reader({ owner, openAt, engine }: { owner: ReaderBridgeController; openAt: string; engine: ReturnType<typeof fakeEngine>["engine"] }) {
  const annotations = useReaderAnnotations({ book: { id: id(2), title: "Là-bas", authors: [] },
    fileId: id(3), deviceId: id(4), engine, painted: true, bridge: owner, selection: null,
    locator, palette: QUIET_GLASS_ANNOTATION_PALETTE, onJump, onNotice, openAt });
  return h("div", null, annotations.markingActions);
}
async function open(state: AnnotationBookState, openAt: string, placed = true) {
  const transport: AnnotationTransport = {
    readBook: async () => structuredClone(state),
    transactBook: async (_id, reduce) => structuredClone(reduce(state)),
    subscribe: () => () => {}, requestReplay: async () => {}, enqueue: async () => {},
  };
  runtime.transport = transport;
  const { engine } = fakeEngine();
  if (!placed) (engine.resolveAnnotation as unknown as { mockImplementation(fn: ReaderEngine["resolveAnnotation"]): void }).mockImplementation(async () => ({ status: "orphaned", locator: null }));
  await act(async () => {
    root.render(h(ReaderBridgeProvider, { context: { ebookId: id(2), fileId: id(3), format: "epub",
      locator, selection: null, chapter: null, percent: 44 },
      plugins: [], children: (owner) => h(Reader, { owner, openAt, engine }) }));
  });
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
  return engine;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  onJump = vi.fn(async () => true); onNotice = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("opening the reader at a mark (SLN-500)", () => {
  it("jumps to the mark's resolved place once", async () => {
    const engine = await open({ annotations: [annotation()], pending: [], cursor: at }, id(1));
    expect(engine.resolveAnnotation).toHaveBeenCalledWith(expect.objectContaining({ id: id(1) }));
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(locator);
    expect(onNotice).not.toHaveBeenCalled();
  });

  it("says a mark this file cannot place stays listed, without jumping", async () => {
    await open({ annotations: [annotation()], pending: [], cursor: at }, id(1), false);
    expect(onJump).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith(unplaced);
  });

  it("says a deleted mark is gone once the marks have synced", async () => {
    await open({ annotations: [annotation({ deletedAt: at })], pending: [], cursor: at }, id(1));
    expect(onJump).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith("That mark is no longer in this book.");
  });

  it("waits for the first sync on a device with no marks yet", async () => {
    await open({ annotations: [], pending: [], cursor: null }, id(1));
    expect(onJump).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });
});
