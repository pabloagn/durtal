import { readerUuid } from "@/lib/reader/uuid";
import type {
  AnnotationColor,
  AnnotationMutation,
  ReaderAnnotation,
} from "./annotations";
import type { AnnotationDeleteHook } from "./annotation-deletion";
import { preparedAnnotationDelete } from "./annotation-deletion";
import type {
  AnnotationResolveResult,
  Decoration,
  DurtalLocator,
  ReaderEngine,
} from "./engine";
import {
  annotationPullSchema,
  annotationUpsertSchema,
} from "@/lib/validations/annotations";
import {
  annotationTimeMicros,
  annotationTimeFromMicros,
  canonicalAnnotationTime,
  compareAnnotationTimes,
} from "./sync/annotation-time";
import {
  pendingAnnotation,
  undoPendingAnnotation,
  type PendingAnnotation,
} from "./sync/annotation-outbox";
import {
  serializeAnnotationOperation,
  type AnnotationBookState,
  type AnnotationTransport,
  type AnnotationProblem,
} from "./sync/annotation-transport";
import {
  overlayPendingAnnotations,
  reconcileAnnotationPull,
} from "./sync/annotations";

export interface AnnotationControllerSnapshot {
  annotations: readonly ReaderAnnotation[];
  pending: readonly PendingAnnotation[];
  conflicts: readonly { operationId: string; reason: string }[];
  problems?: readonly AnnotationProblem[];
  cursor: string | null;
  loaded: boolean;
  error: string | null;
}
export interface AnnotationControllerOptions {
  ebookId: string;
  fileId: string;
  deviceId: string;
  engine: ReaderEngine;
  transport: AnnotationTransport;
  deletion: AnnotationDeleteHook;
  palette: () => { fills: Record<AnnotationColor, string>; quote: string };
  fetch?: typeof fetch;
  window?: Window | null;
  now?: () => number;
  uuid?: () => string;
  yieldWork?: () => Promise<void>;
  onError?: (error: unknown) => void;
}
const emptyBook = (): AnnotationBookState => ({
  annotations: [],
  pending: [],
  cursor: null,
});
const fingerprint = (item: ReaderAnnotation) =>
  JSON.stringify([item.kind, item.fileId, item.locator, item.anchorState]);

/** One book's display/actions over the injected common queue. This controller
 * owns no database, claim, lifecycle seal or HTTP mutation/replay loop.
 * Every visible edit follows the transport's durable commit.
 */
export function createAnnotationController(
  options: AnnotationControllerOptions,
) {
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? (() => readerUuid());
  const doFetch = options.fetch ?? globalThis.fetch;
  const win =
    options.window === undefined
      ? typeof window === "undefined"
        ? null
        : window
      : options.window;
  const life = new AbortController();
  const listeners = new Set<() => void>();
  const resolved = new Map<
    string,
    { fingerprint: string; result: AnnotationResolveResult }
  >();
  let book = emptyBook();
  let display: ReaderAnnotation[] = [];
  let problems: readonly AnnotationProblem[] = [];
  let snapshot: AnnotationControllerSnapshot = {
    annotations: [],
    pending: [],
    conflicts: [],
    cursor: null,
    loaded: false,
    error: null,
  };
  let destroyed = false,
    painted = false;
  let serial: Promise<unknown> = Promise.resolve();
  let pulling: Promise<void> | null = null,
    resolving: Promise<void> | null = null;
  let pullFailure: unknown = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let lastClientTime: string | null = null;
  const visible = () => !win || win.document.visibilityState === "visible";
  const online = () => !win || win.navigator.onLine !== false;
  const canPull = () => !destroyed && painted && visible() && online();
  const report = (error: unknown) => {
    if (destroyed) return;
    options.onError?.(error);
    snapshot = {
      ...snapshot,
      error:
        error instanceof Error
          ? error.message
          : "Annotations could not be saved",
    };
    listeners.forEach((fn) => fn());
  };
  const queue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = serial.then(work);
    serial = next.catch(() => {});
    return next;
  };
  function publish() {
    if (destroyed) return;
    const overlay = overlayPendingAnnotations({
      ebookId: options.ebookId,
      cached: book.annotations,
      pending: book.pending,
    });
    display = overlay.display;
    snapshot = {
      annotations: display.map((item) => {
        const found = resolved.get(item.id);
        if (
          !found ||
          found.fingerprint !== fingerprint(item) ||
          found.result.status === "pending"
        )
          return item;
        return {
          ...item,
          locator: found.result.locator ?? item.locator,
          anchorState: found.result.status,
        };
      }),
      pending: book.pending,
      conflicts: overlay.conflicts,
      problems,
      cursor: book.cursor,
      loaded: true,
      error: null,
    };
    const palette = options.palette();
    const decorations: Decoration[] = [];
    for (const item of display) {
      const found = resolved.get(item.id);
      if (!found || found.fingerprint !== fingerprint(item)) continue;
      const { status, locator } = found.result;
      if (!locator || status === "pending" || status === "orphaned") continue;
      decorations.push({
        id: item.id,
        locator,
        style:
          item.kind === "bookmark" || status === "approximate"
            ? "margin"
            : item.style,
        color:
          item.style === "quote" || !item.color
            ? palette.quote
            : palette.fills[item.color],
        note: !!item.note,
      });
    }
    options.engine.setDecorations("annotations", decorations);
    listeners.forEach((fn) => fn());
  }
  async function refresh() {
    const [current, failures] = await Promise.all([options.transport.readBook(options.ebookId), options.transport.readProblems?.(options.ebookId) ?? Promise.resolve([])]);
    if (destroyed) return;
    problems = failures;
    book = current;
    const ids = new Set(current.annotations.map((item) => item.id));
    current.pending.forEach((row) => ids.add(row.mutation.id));
    for (const id of resolved.keys()) if (!ids.has(id)) resolved.delete(id);
    publish();
    if (painted) resolveMarks();
  }
  const yieldWork =
    options.yieldWork ??
    (() => new Promise<void>((done) => setTimeout(done, 0)));
  function resolveMarks() {
    if (resolving || destroyed || !painted) return;
    resolving = (async () => {
      let changed = 0;
      for (const item of [...display]) {
        if (destroyed) break;
        const key = fingerprint(item);
        if (resolved.get(item.id)?.fingerprint === key) continue;
        let result: AnnotationResolveResult;
        try {
          result = await options.engine.resolveAnnotation(item, {
            signal: life.signal,
          });
        } catch (error) {
          report(error);
          result = { status: "pending", locator: null };
        }
        if (destroyed) break;
        const current = display.find((row) => row.id === item.id);
        if (!current || fingerprint(current) !== key) continue;
        resolved.set(item.id, { fingerprint: key, result });
        if (++changed % 16 === 0) publish();
        if (result.status !== "pending") {
          const confirmed = book.annotations.find(
            (row) => row.id === item.id && !row.deletedAt,
          );
          const locator = result.locator ?? item.locator;
          const targetFile = result.locator ? options.fileId : item.fileId;
          if (
            confirmed &&
            confirmed.clientUpdatedAt === item.clientUpdatedAt &&
            (targetFile !== item.fileId ||
              result.status !== item.anchorState ||
              JSON.stringify(locator) !== JSON.stringify(item.locator)) &&
            !book.pending.some(
              (row) =>
                row.mutation.id === item.id && row.mutation.op === "reanchor",
            )
          ) {
            void enqueueMutation(
              {
                op: "reanchor",
                id: item.id,
                fileId: targetFile,
                locator,
                anchorState: result.status,
                expectedFileId: item.fileId,
                expectedClientUpdatedAt: item.clientUpdatedAt,
              },
              targetFile,
            ).catch(report);
          }
        }
        await yieldWork();
      }
      if (changed) publish();
    })()
      .catch(report)
      .finally(() => {
        resolving = null;
        if (
          !destroyed &&
          display.some(
            (item) => resolved.get(item.id)?.fingerprint !== fingerprint(item),
          )
        )
          resolveMarks();
      });
  }
  function clientTime() {
    let micros = BigInt(Math.floor(now())) * BigInt(1000);
    for (const item of display) {
      const previous = annotationTimeMicros(item.clientUpdatedAt) + BigInt(1);
      if (previous > micros) micros = previous;
    }
    if (lastClientTime) {
      const previous = annotationTimeMicros(lastClientTime) + BigInt(1);
      if (previous > micros) micros = previous;
    }
    lastClientTime = annotationTimeFromMicros(micros);
    return lastClientTime;
  }
  async function persistMutation(
    mutation: AnnotationMutation,
    fileId: string,
    deletionSnapshot?: ReaderAnnotation,
  ) {
    if (destroyed) throw new Error("This reader is closed");
    const confirmed = book.annotations.find((row) => row.id === mutation.id);
    const pending = pendingAnnotation({
      ebookId: options.ebookId,
      operationId: uuid(),
      revision: 1,
      mutation,
      now: now(),
      baseVersion: confirmed?.clientUpdatedAt ?? null,
      snapshot: deletionSnapshot,
    });
    await options.transport.enqueue(
      serializeAnnotationOperation(pending, {
        fileId,
        expectedDeviceId: options.deviceId,
        createdAt: canonicalAnnotationTime(new Date(now()).toISOString()),
      }),
    );
    await refresh();
  }
  function enqueueMutation(
    mutation: AnnotationMutation,
    fileId: string,
    deletionSnapshot?: ReaderAnnotation,
  ) {
    return queue(async () => {
      if (destroyed) throw new Error("This reader is closed");
      await refresh();
      await persistMutation(mutation, fileId, deletionSnapshot);
    });
  }
  async function pull() {
    if (!canPull()) return;
    if (pulling) return pulling;
    pullFailure = null;
    pulling = (async () => {
      const current = await options.transport.readBook(options.ebookId);
      // Local reads may outlive this reader or a connectivity change.
      if (!canPull()) return;
      const query = current.cursor
        ? `?since=${encodeURIComponent(current.cursor)}`
        : "";
      const response = await doFetch(
        `/api/reader/${options.ebookId}/annotations${query}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: life.signal,
        },
      );
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        throw new Error("Annotations could not be refreshed");
      const received = annotationPullSchema.parse(await response.json());
      if (destroyed) return;
      await options.transport.transactBook(options.ebookId, (latest) => {
        if (destroyed) return latest;
        // A peer may have committed a newer pull during this request.
        if (
          latest.cursor &&
          compareAnnotationTimes(latest.cursor, received.serverTime) > 0
        )
          return latest;
        const reconciled = reconcileAnnotationPull({
          ebookId: options.ebookId,
          cached: latest.annotations,
          cursor: latest.cursor,
          pending: latest.pending,
          response: received,
        });
        return {
          annotations: reconciled.cached,
          cursor: reconciled.cursor,
          pending: latest.pending,
        };
      });
      await refresh();
    })()
      .catch((error: unknown) => { pullFailure = error; report(error); })
      .finally(() => {
        pulling = null;
      });
    return pulling;
  }
  const unsubscribe = options.transport.subscribe(options.ebookId, () => {
    void queue(refresh).catch(report);
  });
  const documentLoaded = options.engine.on("document", () => {
    for (const [id, entry] of resolved)
      if (entry.result.status === "pending") resolved.delete(id);
    resolveMarks();
  });
  const onVisible = () => {
    if (visible()) void pull();
  };
  const onOnline = () => {
    if (!canPull()) return;
    void queue(async () => {
      // Reconnection needs a fresh server snapshot after any older request.
      if (pulling) await pulling;
      await pull();
    }).catch(report);
  };
  win?.document.addEventListener("visibilitychange", onVisible);
  win?.addEventListener("online", onOnline);
  const ready = queue(refresh).catch(report);
  return {
    ready,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Called only after owned navigation's first successful painted landing. */
    firstPaint() {
      if (painted || destroyed) return;
      painted = true;
      resolveMarks();
      void pull();
      interval = setInterval(
        () => {
          void pull();
        },
        5 * 60 * 1000,
      );
    },
    pull,
    /** A tracker commit may occur after an in-flight pull took its server
     * snapshot. Wait for that pull, then start another; never reuse its result.
     */
    serverChanged() {
      return queue(async () => {
        if (pulling) await pulling;
        if (!destroyed) await pull();
        // Background pulls report in the snapshot instead of rejecting. A
        // committed-write caller needs that failure without retrying its save.
        if (canPull() && pullFailure) throw pullFailure;
      });
    },
    async retryBlocked(operationId: string, revision: number) {
      return queue(async () => {
        if (destroyed || !options.transport.retryBlocked) return false;
        const changed = await options.transport.retryBlocked(options.ebookId, operationId, revision);
        await refresh(); return changed;
      });
    },
    repaint: publish,
    async createHighlight(input: {
      text: string;
      locator: DurtalLocator;
      chapter: string | null;
      color: AnnotationColor;
      style?: "highlight" | "underline";
    }) {
      await ready;
      const id = uuid();
      const mutation = annotationUpsertSchema(now()).parse({
        op: "put",
        id,
        fileId: options.fileId,
        kind: "highlight",
        style: input.style ?? "highlight",
        color: input.color,
        locator: input.locator,
        text: input.text,
        chapter: input.chapter,
        note: null,
        clientUpdatedAt: clientTime(),
      });
      await enqueueMutation(mutation, options.fileId);
      return id;
    },
    async createBookmark(input: {
      locator: DurtalLocator;
      chapter: string | null;
    }) {
      await ready;
      const id = uuid();
      const mutation = annotationUpsertSchema(now()).parse({
        op: "put",
        id,
        fileId: options.fileId,
        kind: "bookmark",
        style: "highlight",
        color: null,
        text: null,
        note: null,
        locator: input.locator,
        chapter: input.chapter,
        clientUpdatedAt: clientTime(),
      });
      await enqueueMutation(mutation, options.fileId);
      return id;
    },
    async edit(
      id: string,
      patch: {
        color?: AnnotationColor;
        style?: "highlight" | "underline";
        note?: string | null;
      },
    ) {
      await ready;
      // Build from the latest durable overlay inside the serialized action.
      // A simultaneous colour edit must not overwrite a just-saved note.
      return queue(async () => {
        await refresh();
        const item = display.find((row) => row.id === id);
        const shown = snapshot.annotations.find((row) => row.id === id);
        if (
          !item ||
          item.kind !== "highlight" ||
          shown?.anchorState === "orphaned"
        )
          throw new Error("This mark cannot be edited");
        if (
          item.style === "quote" &&
          (patch.color !== undefined || patch.style !== undefined)
        )
          throw new Error("Quote style is fixed");
        const onlyNote = patch.color === undefined && patch.style === undefined;
        const mutation = annotationUpsertSchema(now()).parse(
          onlyNote
            ? {
                op: "note",
                id,
                note: patch.note ?? null,
                clientUpdatedAt: clientTime(),
              }
            : {
                op: "put",
                id,
                fileId: item.fileId,
                kind: item.kind,
                style: patch.style ?? item.style,
                color: patch.color ?? item.color,
                locator: item.locator,
                text: item.text,
                note: patch.note === undefined ? item.note : patch.note,
                chapter: item.chapter,
                clientUpdatedAt: clientTime(),
              },
        );
        await persistMutation(mutation, item.fileId);
      });
    },
    async delete(id: string) {
      await ready;
      const item = display.find((row) => row.id === id);
      if (!item) return null;
      const prepared = await options.deletion.prepare(
        structuredClone(item),
        life.signal,
      );
      if (prepared.status === "cancel" || life.signal.aborted) return null;
      return queue(async () => {
        await refresh();
        const current = display.find((row) => row.id === id);
        if (!current) return null;
        const mutation = preparedAnnotationDelete({
          annotation: current,
          prepared,
          clientUpdatedAt: clientTime(),
          signal: life.signal,
        });
        if (!mutation) return null;
        await persistMutation(mutation, current.fileId, current);
        return (
          snapshot.pending.find(
            (row) => row.mutation.op === "delete" && row.mutation.id === id,
          )?.operationId ?? null
        );
      });
    },
    async undo(operationId: string) {
      return queue(async () => {
        let undone = false;
        await options.transport.transactBook(options.ebookId, (current) => {
          const row = current.pending.find(
            (item) => item.operationId === operationId,
          );
          if (!row || !undoPendingAnnotation(row, now()).undone) return current;
          undone = true;
          return {
            ...current,
            pending: current.pending.filter(
              (item) => item.operationId !== operationId,
            ),
          };
        });
        await refresh();
        return undone;
      });
    },
    destroy() {
      destroyed = true;
      life.abort();
      if (interval) clearInterval(interval);
      unsubscribe();
      documentLoaded();
      win?.document.removeEventListener("visibilitychange", onVisible);
      win?.removeEventListener("online", onOnline);
      options.engine.setDecorations("annotations", []);
      listeners.clear();
      resolved.clear();
    },
  };
}
export type AnnotationController = ReturnType<
  typeof createAnnotationController
>;
