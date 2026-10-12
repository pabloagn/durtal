// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAnnotationController,
  type AnnotationController,
} from "@/lib/reader/annotation-controller";
import type {
  AnnotationBookState,
  AnnotationTransport,
  DurableAnnotationOperation,
} from "@/lib/reader/sync/annotation-transport";
import { pendingAnnotation } from "@/lib/reader/sync/annotation-outbox";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import { fakeEngine } from "./fixtures/fake-engine";
import { annotation, at, id, later, locator } from "./fixtures/annotation";

const controllers: AnnotationController[] = [];
let connected = false;
let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  connected = false;
  visibility = "visible";
  vi.spyOn(window.navigator, "onLine", "get").mockImplementation(() => connected);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.destroy());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function response(
  annotations: AnnotationBookState["annotations"] = [],
  serverTime = later,
) {
  return new Response(JSON.stringify({ annotations, reset: false, serverTime }), {
    headers: { "content-type": "application/json" },
  });
}
function fixture(
  initial: AnnotationBookState = { annotations: [], pending: [], cursor: at },
) {
  let current = structuredClone(initial);
  let serial = 20;
  let waitForTransaction: (() => Promise<void>) | null = null;
  const changes = new Set<() => void>();
  const enqueued: DurableAnnotationOperation[] = [];
  const notify = () => changes.forEach((listener) => listener());
  const readProblems = vi.fn<NonNullable<AnnotationTransport["readProblems"]>>(async () => []);
  const transport: AnnotationTransport = {
    readBook: vi.fn(async () => structuredClone(current)),
    readProblems,
    enqueue: vi.fn(async (operation) => {
      enqueued.push(structuredClone(operation));
      current.pending = [...current.pending, structuredClone(operation.local)];
      notify();
    }),
    transactBook: vi.fn(async (_ebookId, reduce) => {
      if (waitForTransaction) await waitForTransaction();
      current = structuredClone(reduce(structuredClone(current)));
      notify();
      return structuredClone(current);
    }),
    subscribe: vi.fn((_ebookId, listener) => {
      changes.add(listener);
      return () => { changes.delete(listener); };
    }),
    requestReplay: vi.fn(async () => {}),
  };
  const { engine } = fakeEngine();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
  const onError = vi.fn<(error: unknown) => void>();
  const controller = createAnnotationController({
    ebookId: id(2), fileId: id(3), deviceId: id(4), engine, transport,
    deletion: { prepare: async () => ({ status: "proceed", effect: { action: "none" } }) },
    palette: () => QUIET_GLASS_ANNOTATION_PALETTE,
    fetch, window, onError,
    now: () => Date.parse(later), uuid: () => id(++serial),
    yieldWork: async () => {},
  });
  controllers.push(controller);
  return {
    controller, transport, engine, fetch, onError, enqueued, readProblems,
    getBook: () => structuredClone(current),
    waitForTransaction(work: () => Promise<void>) { waitForTransaction = work; },
  };
}
function reconnect() {
  connected = true;
  window.dispatchEvent(new Event("online"));
}

describe("offline annotation admission and owned reconnect refresh", () => {
  it("loads an empty local book without GET or error on first paint, manual refresh, visibility, or polling", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.controller.ready;
    f.controller.firstPaint();
    await f.controller.pull();
    await f.controller.serverChanged();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(f.controller.getSnapshot()).toMatchObject({
      loaded: true, annotations: [], pending: [], cursor: at, error: null,
    });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
    expect(f.transport.transactBook).not.toHaveBeenCalled();
    expect(f.transport.requestReplay).not.toHaveBeenCalled();
  });

  it("retains and decorates cached marks with the exact pending note while offline", async () => {
    const pending = pendingAnnotation({
      ebookId: id(2), operationId: id(10), revision: 3, baseVersion: at,
      now: Date.parse(later),
      mutation: { op: "note", id: id(1), note: "Offline note", clientUpdatedAt: later },
    });
    const f = fixture({ annotations: [annotation()], pending: [pending], cursor: at });
    await f.controller.ready;
    expect(f.engine.resolveAnnotation).not.toHaveBeenCalled();
    f.controller.firstPaint();
    await f.controller.pull();
    await vi.waitFor(() => expect(f.engine.setDecorations).toHaveBeenLastCalledWith(
      "annotations", [expect.objectContaining({ id: id(1), locator, note: true })],
    ));
    expect(f.controller.getSnapshot()).toMatchObject({
      loaded: true, annotations: [{ id: id(1), note: "Offline note", locator }],
      pending: [pending], cursor: at, error: null,
    });
    expect(f.getBook()).toEqual({ annotations: [annotation()], pending: [pending], cursor: at });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
    expect(f.enqueued).toEqual([]);
  });

  it("still commits an offline bookmark to the common durable queue without a remote read", async () => {
    const f = fixture();
    await f.controller.ready;
    f.controller.firstPaint();
    const created = await f.controller.createBookmark({ locator, chapter: "Chapter" });
    expect(f.enqueued).toHaveLength(1);
    expect(f.enqueued[0]).toMatchObject({
      ebookId: id(2), fileId: id(3), expectedDeviceId: id(4), revision: 1,
      local: { mutation: { id: created, op: "put", kind: "bookmark" } },
    });
    expect(f.controller.getSnapshot().annotations).toMatchObject([{ id: created, kind: "bookmark" }]);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("rejects a genuine offline durable write failure without publishing the unsaved mark", async () => {
    const f = fixture();
    const failure = new Error("Annotation queue quota exceeded");
    vi.mocked(f.transport.enqueue).mockRejectedValueOnce(failure);
    await f.controller.ready;
    f.controller.firstPaint();
    await expect(f.controller.createBookmark({ locator, chapter: null })).rejects.toBe(failure);
    expect(f.controller.getSnapshot().annotations).toEqual([]);
    expect(f.controller.getSnapshot().pending).toEqual([]);
    expect(f.enqueued).toEqual([]);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("requests a real fresh server snapshot on reconnect and merges it without inventing a mutation", async () => {
    const f = fixture();
    f.fetch.mockImplementation(async () => response([annotation({ updatedAt: later })]));
    await f.controller.ready;
    f.controller.firstPaint();
    expect(f.fetch).not.toHaveBeenCalled();
    reconnect();
    await vi.waitFor(() => expect(f.controller.getSnapshot().cursor).toBe(later));
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch).toHaveBeenCalledWith(
      `/api/reader/${id(2)}/annotations?since=${encodeURIComponent(at)}`,
      expect.objectContaining({ credentials: "same-origin", cache: "no-store", redirect: "error", signal: expect.any(AbortSignal) }),
    );
    expect(f.controller.getSnapshot().annotations).toEqual([annotation({ updatedAt: later })]);
    expect(f.transport.transactBook).toHaveBeenCalledTimes(1);
    expect(f.enqueued).toEqual([]);
    expect(f.transport.requestReplay).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("admits a reconnect read only after the owned first painted landing", async () => {
    const f = fixture();
    await f.controller.ready;
    reconnect();
    await f.controller.pull();
    expect(f.fetch).not.toHaveBeenCalled();
    f.controller.firstPaint();
    await f.controller.pull();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().cursor).toBe(later);
  });

  it("defers hidden reconnect reads until the document becomes visible", async () => {
    const f = fixture();
    await f.controller.ready;
    f.controller.firstPaint();
    visibility = "hidden";
    reconnect();
    await f.controller.pull();
    expect(f.fetch).not.toHaveBeenCalled();
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await f.controller.pull();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("does not start a GET if connectivity is lost while reading the local cursor", async () => {
    const f = fixture();
    await f.controller.ready;
    const read = deferred<AnnotationBookState>();
    vi.mocked(f.transport.readBook).mockReturnValueOnce(read.promise);
    connected = true;
    f.controller.firstPaint();
    const pull = f.controller.pull();
    connected = false;
    read.resolve(f.getBook());
    await pull;
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
    reconnect();
    await vi.waitFor(() => expect(f.controller.getSnapshot().cursor).toBe(later));
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it("retires an owner awaiting its local cursor and lets only the replacement refresh on reconnect", async () => {
    const old = fixture();
    await old.controller.ready;
    const read = deferred<AnnotationBookState>();
    vi.mocked(old.transport.readBook).mockReturnValueOnce(read.promise);
    connected = true;
    old.controller.firstPaint();
    const pull = old.controller.pull();
    old.controller.destroy();
    connected = false;
    const next = fixture();
    await next.controller.ready;
    next.controller.firstPaint();
    reconnect();
    read.resolve(old.getBook());
    await pull;
    await vi.waitFor(() => expect(next.controller.getSnapshot().cursor).toBe(later));
    expect(old.fetch).not.toHaveBeenCalled();
    expect(old.transport.transactBook).not.toHaveBeenCalled();
    expect(old.onError).not.toHaveBeenCalled();
    expect(next.fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts an owned request and ignores a late successful response after destruction", async () => {
    const f = fixture();
    await f.controller.ready;
    const request = deferred<Response>();
    f.fetch.mockReturnValueOnce(request.promise);
    connected = true;
    f.controller.firstPaint();
    const pull = f.controller.pull();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(1));
    const signal = f.fetch.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    f.controller.destroy();
    expect(signal?.aborted).toBe(true);
    request.resolve(response([annotation()]));
    await pull;
    reconnect();
    await f.controller.pull();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.transport.transactBook).not.toHaveBeenCalled();
    expect(f.getBook()).toEqual({ annotations: [], pending: [], cursor: at });
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("does not notify a retired reader when its old request rejects", async () => {
    const f = fixture();
    await f.controller.ready;
    const request = deferred<Response>();
    f.fetch.mockReturnValueOnce(request.promise);
    connected = true;
    f.controller.firstPaint();
    const pull = f.controller.pull();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(1));
    f.controller.destroy();
    request.reject(new TypeError("Network request failed"));
    await pull;
    expect(f.onError).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().error).toBeNull();
    expect(f.transport.transactBook).not.toHaveBeenCalled();
  });

  it("cancels an already queued reconnect callback and removes its listener on destruction", async () => {
    const f = fixture();
    await f.controller.ready;
    f.controller.firstPaint();
    reconnect();
    f.controller.destroy();
    await f.controller.serverChanged();
    reconnect();
    await f.controller.serverChanged();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.transport.transactBook).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("does not merge a retired response while waiting to enter the local transaction", async () => {
    const f = fixture();
    await f.controller.ready;
    const transaction = deferred<void>();
    f.waitForTransaction(() => transaction.promise);
    f.fetch.mockImplementation(async () => response([annotation()]));
    connected = true;
    f.controller.firstPaint();
    const pull = f.controller.pull();
    await vi.waitFor(() => expect(f.transport.transactBook).toHaveBeenCalledTimes(1));
    f.controller.destroy();
    transaction.resolve(undefined);
    await pull;
    expect(f.getBook()).toEqual({ annotations: [], pending: [], cursor: at });
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("refreshes again after an older in-flight GET instead of treating its stale result as the reconnect read", async () => {
    const f = fixture();
    await f.controller.ready;
    const oldResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(oldResponse.promise);
    f.fetch.mockImplementation(async () => response([annotation({ updatedAt: later })]));
    connected = true;
    f.controller.firstPaint();
    const pull = f.controller.pull();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(1));
    connected = false;
    reconnect();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    oldResponse.resolve(response([], at));
    await pull;
    await vi.waitFor(() => expect(f.controller.getSnapshot().cursor).toBe(later));
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.controller.getSnapshot().annotations).toEqual([annotation({ updatedAt: later })]);
    expect(f.onError).not.toHaveBeenCalled();
  });

  it.each(["readBook", "readProblems"] as const)("still reports genuine local %s corruption while offline", async (method) => {
    const f = fixture();
    const failure = new Error("Invalid stored annotation identity");
    if (method === "readBook") vi.mocked(f.transport.readBook).mockRejectedValueOnce(failure);
    else f.readProblems.mockRejectedValueOnce(failure);
    await f.controller.ready;
    f.controller.firstPaint();
    await f.controller.pull();
    expect(f.onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(f.controller.getSnapshot()).toMatchObject({ loaded: false, error: failure.message });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.enqueued).toEqual([]);
  });

  it.each([
    { name: "server rejection", receive: async () => new Response(null, { status: 503 }) },
    { name: "non-JSON server response", receive: async () => new Response("Login", { headers: { "content-type": "text/html" } }) },
    { name: "invalid server payload", receive: async () => new Response("{}", { headers: { "content-type": "application/json" } }) },
    { name: "network rejection despite online admission", receive: async (): Promise<Response> => { throw new TypeError("Network request failed"); } },
  ])("still reports $name and rejects a committed-write refresh while online", async ({ receive }) => {
    const f = fixture({ annotations: [annotation()], pending: [], cursor: at });
    f.fetch.mockImplementation(receive);
    await f.controller.ready;
    connected = true;
    f.controller.firstPaint();
    await f.controller.pull();
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(f.onError).toHaveBeenCalledWith(expect.any(Error));
    const failure = f.onError.mock.calls[0][0];
    if (!(failure instanceof Error)) throw new Error("Expected the original refresh error");
    expect(f.controller.getSnapshot().error).toBe(failure.message);
    expect(f.getBook()).toEqual({ annotations: [annotation()], pending: [], cursor: at });
    await expect(f.controller.serverChanged()).rejects.toThrow();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.onError).toHaveBeenCalledTimes(2);
    expect(f.transport.transactBook).not.toHaveBeenCalled();
  });

  it("does not clear an existing genuine error or repeat it when an offline refresh is skipped", async () => {
    const f = fixture();
    f.fetch.mockImplementation(async () => new Response(null, { status: 503 }));
    await f.controller.ready;
    connected = true;
    f.controller.firstPaint();
    await f.controller.pull();
    expect(f.controller.getSnapshot().error).toBe("Annotations could not be refreshed");
    connected = false;
    await f.controller.pull();
    await expect(f.controller.serverChanged()).resolves.toBeUndefined();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().error).toBe("Annotations could not be refreshed");
  });
});
