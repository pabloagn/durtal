import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnnotationController } from "@/lib/reader/annotation-controller";
import { refreshServerAnnotations, saveQuoteWithRefresh, subscribeAnnotationServerChanges } from "@/lib/reader/annotation-server-changes";
import type { AnnotationBookState, AnnotationTransport } from "@/lib/reader/sync/annotation-transport";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import { fakeEngine } from "./fixtures/fake-engine";
import { annotation, id, later } from "./fixtures/annotation";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach((stop) => stop()));
const response = (annotations: AnnotationBookState["annotations"]) => new Response(
  JSON.stringify({ annotations, reset: false, serverTime: later }),
  { headers: { "content-type": "application/json" } },
);

describe("committed quote annotation handoff", () => {
  it("pulls after the actual save and an older in-flight GET, reconciles transport, and paints the quote", async () => {
    let current: AnnotationBookState = { annotations: [], pending: [], cursor: null };
    let server: AnnotationBookState["annotations"] = [];
    let release!: () => void;
    const stale = new Promise<void>((done) => { release = done; });
    let requests = 0;
    let offline = false;
    const fetch = vi.fn(async () => {
      if (offline) return new Response(null, { status: 503 });
      const captured = structuredClone(server);
      if (++requests === 1) await stale;
      return response(captured);
    });
    const listeners = new Set<() => void>();
    const transport: AnnotationTransport = {
      enqueue: vi.fn(async () => {}),
      readBook: vi.fn(async () => structuredClone(current)),
      transactBook: vi.fn(async (_ebookId, reduce) => {
        current = structuredClone(reduce(structuredClone(current)));
        listeners.forEach((fn) => fn());
        return structuredClone(current);
      }),
      subscribe: (_ebookId, listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      requestReplay: vi.fn(async () => {}),
    };
    const { engine } = fakeEngine();
    const controller = createAnnotationController({
      ebookId: id(2), fileId: id(3), deviceId: id(4), engine, transport, fetch,
      deletion: { prepare: async () => ({ status: "proceed", effect: { action: "none" } }) },
      palette: () => QUIET_GLASS_ANNOTATION_PALETTE,
      now: () => Date.parse(later), uuid: () => id(10), window: null,
      yieldWork: async () => {},
    });
    cleanup.push(() => controller.destroy());
    cleanup.push(subscribeAnnotationServerChanges(id(2), () => controller.serverChanged()));
    await controller.ready;
    controller.firstPaint();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const failed = vi.fn();
    const saving = saveQuoteWithRefresh(id(2), async () => {
      server = [annotation({ style: "quote", color: null, updatedAt: later })];
      return { annotationId: id(1) };
    }, failed);
    expect(controller.getSnapshot().annotations).toEqual([]);
    release();
    expect(await saving).toEqual({ annotationId: id(1) });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(2,
      `/api/reader/${id(2)}/annotations?since=${encodeURIComponent(later)}`,
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
    expect(transport.transactBook).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().annotations).toMatchObject([{ id: id(1), style: "quote" }]);
    await vi.waitFor(() => expect(engine.setDecorations).toHaveBeenLastCalledWith(
      "annotations", [expect.objectContaining({ id: id(1), style: "quote" })],
    ));
    expect(transport.enqueue).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    offline = true;
    expect(await saveQuoteWithRefresh(id(2), async () => ({ annotationId: id(1) }), failed)).toEqual({ annotationId: id(1) });
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: "Annotations could not be refreshed" }));
  });

  it("never refreshes before commit or after a rejected save", async () => {
    const refresh = vi.fn(async () => {});
    cleanup.push(subscribeAnnotationServerChanges(id(20), refresh));
    let commit!: () => void;
    const saved = new Promise<void>((done) => { commit = done; });
    const saving = saveQuoteWithRefresh(id(20), () => saved, vi.fn());
    expect(refresh).not.toHaveBeenCalled();
    commit();
    await saving;
    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(saveQuoteWithRefresh(id(20), async () => { throw new Error("Save rejected"); }, vi.fn())).rejects.toThrow("Save rejected");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("preserves a committed result if refresh fails and unregisters the old owner", async () => {
    const refresh = vi.fn(async () => { throw new Error("Offline"); });
    const stop = subscribeAnnotationServerChanges(id(21), refresh);
    cleanup.push(stop);
    const failed = vi.fn();
    expect(await saveQuoteWithRefresh(id(21), async () => ({ annotationId: id(1) }), failed)).toEqual({ annotationId: id(1) });
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: "Offline" }));
    stop();
    const replacement = vi.fn(async () => {});
    cleanup.push(subscribeAnnotationServerChanges(id(21), replacement));
    stop(); // Repeated cleanup must not unregister the next owner generation.
    await refreshServerAnnotations(id(21));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(replacement).toHaveBeenCalledTimes(1);
  });
});
