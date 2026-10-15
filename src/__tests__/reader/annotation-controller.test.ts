import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnnotationController,
  type AnnotationController,
} from "@/lib/reader/annotation-controller";
import type {
  AnnotationBookState,
  AnnotationTransport,
  DurableAnnotationOperation,
} from "@/lib/reader/sync/annotation-transport";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import { fakeEngine } from "./fixtures/fake-engine";
import { annotation, at, id, later, locator } from "./fixtures/annotation";

const controllers: AnnotationController[] = [];
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.destroy());
});
function fixture(
  initial: AnnotationBookState = {
    annotations: [annotation()],
    pending: [],
    cursor: at,
  },
) {
  let current = structuredClone(initial),
    serial = 10;
  let commit: (() => Promise<void>) | null = null;
  const changes = new Set<() => void>();
  const enqueued: DurableAnnotationOperation[] = [];
  const { engine } = fakeEngine();
  const notify = () => changes.forEach((fn) => fn());
  const transport: AnnotationTransport = {
    enqueue: vi.fn(async (operation) => {
      if (commit) await commit();
      enqueued.push(structuredClone(operation));
      current.pending = [
        ...current.pending,
        {
          ...structuredClone(operation.local),
          transportIdentity: {
            fileId: operation.fileId,
            expectedDeviceId: operation.expectedDeviceId,
            createdAt: operation.createdAt,
          },
        },
      ];
      notify();
    }),
    readBook: vi.fn(async () => structuredClone(current)),
    transactBook: vi.fn(async (_ebookId, reduce) => {
      current = structuredClone(reduce(structuredClone(current)));
      notify();
      return structuredClone(current);
    }),
    subscribe: (_ebookId, listener) => {
      changes.add(listener);
      return () => {
        changes.delete(listener);
      };
    },
    requestReplay: vi.fn(async () => {}),
  };
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          annotations: current.annotations,
          reset: false,
          serverTime: later,
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
  );
  const prepare = vi.fn(async () => ({
    status: "proceed" as const,
    effect: { action: "none" as const },
  }));
  const controller = createAnnotationController({
    ebookId: id(2),
    fileId: id(3),
    deviceId: id(4),
    engine,
    transport,
    deletion: { prepare },
    palette: () => QUIET_GLASS_ANNOTATION_PALETTE,
    now: () => Date.parse(later),
    uuid: () => id(++serial),
    window: null,
    fetch,
    yieldWork: async () => {},
  });
  controllers.push(controller);
  return {
    controller,
    transport,
    engine,
    fetch,
    prepare,
    enqueued,
    setCommit(fn: () => Promise<void>) {
      commit = fn;
    },
    seal() {
      current.pending = current.pending.map((row) =>
        row.mutation.op === "delete"
          ? { ...row, stage: "sealed" as const }
          : row,
      );
      notify();
    },
  };
}
describe("injected annotation controller", () => {
  it("loads durable local data but neither pulls nor resolves before first painted landing", async () => {
    const f = fixture();
    await f.controller.ready;
    expect(f.controller.getSnapshot().annotations).toEqual([annotation()]);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.engine.resolveAnnotation).not.toHaveBeenCalled();
    f.controller.firstPaint();
    await f.controller.pull();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.engine.resolveAnnotation).toHaveBeenCalled();
    expect(f.engine.goTo).not.toHaveBeenCalled();
    expect(f.transport.requestReplay).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().cursor).toBe(later);
  });
  it("writes no reanchor when the resolved place only lists its fields in another order (SLN-670)", async () => {
    const f = fixture();
    const { text, ...rest } = locator;
    const reordered = { text: { after: text.after, highlight: text.highlight, before: text.before }, ...rest, cfi: locator.cfi, extra: undefined };
    f.engine.resolveAnnotation.mockImplementation(async () => ({ status: "exact" as const, locator: reordered }));
    await f.controller.ready;
    f.controller.firstPaint();
    await f.controller.pull();
    await vi.waitFor(() => expect(f.engine.resolveAnnotation).toHaveBeenCalled());
    await new Promise((done) => setTimeout(done, 0));
    expect(f.enqueued).toEqual([]);
  });
  it("writes no reanchor for a PDF mark another browser measures a fraction of a point apart, and one for a real move (SLN-670)", async () => {
    const pdf = { page: 3, rects: [[10.12, 20.4, 100.5, 30.2]] as [number, number, number, number][] };
    const shifted = (by: number) => ({ ...locator, pdf: { page: 3, rects: pdf.rects.map((rect) => rect.map((n) => n + by) as [number, number, number, number]) } });
    for (const [by, writes] of [[0.37, 0], [6, 1]] as const) {
      const f = fixture({ annotations: [annotation({ locator: { ...locator, pdf } })], pending: [], cursor: at });
      f.engine.resolveAnnotation.mockImplementation(async () => ({ status: "exact" as const, locator: shifted(by) }));
      await f.controller.ready;
      f.controller.firstPaint();
      await f.controller.pull();
      await vi.waitFor(() => expect(f.engine.resolveAnnotation).toHaveBeenCalled());
      await new Promise((done) => setTimeout(done, 0));
      expect(f.enqueued).toHaveLength(writes);
    }
  });
  it("publishes a new highlight only after the captured operation commits durably", async () => {
    const f = fixture({ annotations: [], pending: [], cursor: null });
    await f.controller.ready;
    let release!: () => void;
    f.setCommit(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    const saving = f.controller.createHighlight({
      text: "The quiet glass.",
      locator,
      chapter: "Chapter",
      color: "sage",
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(f.controller.getSnapshot().annotations).toEqual([]);
    release();
    const created = await saving;
    expect(f.controller.getSnapshot().annotations).toMatchObject([
      { id: created, color: "sage", note: null },
    ]);
    expect(f.enqueued[0]).toMatchObject({
      ebookId: id(2),
      fileId: id(3),
      expectedDeviceId: id(4),
      revision: 1,
    });
    expect(f.enqueued[0].body).toContain("The quiet glass.");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("serializes note then colour edits without losing the note or changing the stored anchor", async () => {
    const f = fixture();
    await f.controller.ready;
    await Promise.all([
      f.controller.edit(id(1), { note: "Saved draft" }),
      f.controller.edit(id(1), { color: "rose" }),
    ]);
    expect(f.controller.getSnapshot().annotations).toMatchObject([
      { note: "Saved draft", color: "rose", locator },
    ]);
    expect(f.enqueued[1].local.mutation).toMatchObject({
      op: "put",
      note: "Saved draft",
      color: "rose",
      locator,
    });
    expect(f.enqueued[0].operationId).not.toBe(f.enqueued[1].operationId);
  });
  it("cancellation creates no operation; Undo removes the whole pre-seal delete", async () => {
    const f = fixture();
    await f.controller.ready;
    f.prepare.mockResolvedValueOnce({ status: "cancel" } as never);
    expect(await f.controller.delete(id(1))).toBeNull();
    expect(f.enqueued).toEqual([]);
    const operationId = await f.controller.delete(id(1));
    expect(f.controller.getSnapshot().annotations).toEqual([]);
    expect(await f.controller.undo(operationId!)).toBe(true);
    expect(f.controller.getSnapshot().annotations).toEqual([annotation()]);
    expect(f.controller.getSnapshot().pending).toEqual([]);
  });
  it("a durably sealed delete cannot be restored while its original deadline remains open", async () => {
    const f = fixture();
    await f.controller.ready;
    const operationId = await f.controller.delete(id(1));
    f.seal();
    expect(await f.controller.undo(operationId!)).toBe(false);
    expect(f.controller.getSnapshot().annotations).toEqual([]);
    expect(f.controller.getSnapshot().pending).toMatchObject([
      { stage: "sealed" },
    ]);
  });
  it("keeps quote styling fixed while saving its note through the common queue", async () => {
    const f = fixture({
      annotations: [annotation({ style: "quote", color: null })],
      pending: [],
      cursor: at,
    });
    await f.controller.ready;
    await expect(f.controller.edit(id(1), { color: "violet" })).rejects.toThrow(
      "Quote style is fixed",
    );
    await f.controller.edit(id(1), { note: "Quote note" });
    expect(f.enqueued).toHaveLength(1);
    expect(f.enqueued[0].local.mutation).toMatchObject({
      op: "note",
      note: "Quote note",
    });
    expect(f.controller.getSnapshot().annotations).toMatchObject([
      { style: "quote", color: null, note: "Quote note" },
    ]);
  });
});
