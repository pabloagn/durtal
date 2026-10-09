import {
  OFFLINE_DATABASE_VERSION,
  OFFLINE_STORES,
  recordVersionPolicy,
  validateMutation,
  mutationKey,
  type AnnotationMutation,
  type ReaderMutation,
  type Json,
  type JsonObject,
} from "./mutations";
import {
  coalescePositions,
  comparePositionTimes,
  matchesClaim,
  planReplayClaim,
  reconcileBlocked,
  releaseClaim,
  type AnnotationItemOutcome,
  type BlockedOperationReference,
  type ClaimPlan,
  type OperationReference,
  type OutboxRow,
} from "./outbox-policy";

export interface AnnotationLocal {
  /** Opaque owner state; the annotation owner provides its encoder/decoder. */
  pending: JsonObject;
  undo: {
    state: "undoable" | "sealed";
    until: number | null;
    snapshot: JsonObject;
  } | null;
}
export interface DurableInput {
  mutation: ReaderMutation;
  annotation?: AnnotationLocal;
}
export interface StoredOperation extends OutboxRow {
  v: 1;
  annotation?: AnnotationLocal;
  retryAt: number | null;
}
export interface AnnotationBook {
  annotations: Json[];
  cursor: string | null;
  pending: StoredOperation[];
}
interface BookRecord {
  v: 1;
  key: string;
  annotations: Json[];
  cursor: string | null;
}
interface Receipt {
  v: 1;
  key: string;
  original: string;
  outcome: "acknowledged" | "rejected" | "ignored" | "undone" | "coalesced";
}
export interface LocalPosition {
  v: 1;
  key: string;
  latest: ReaderMutation;
  milestone: ReaderMutation;
}
export type StoreClaim =
  | ClaimPlan
  | { kind: "stop"; reason: "undo_pending" | "backoff" };
export interface StoreOptions {
  indexedDB?: IDBFactory;
  name?: string;
  now?: () => number;
  validateAnnotations: (body: AnnotationMutation["body"]) => boolean;
  channel?: BroadcastChannel | null;
}
const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("IndexedDB request failed"));
  });
const bookKey = (id: string) => `book:${id.toLowerCase()}`;
const receiptKey = (id: string) => `operation:${id}`;
const original = (input: DurableInput) => JSON.stringify(input.mutation);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** One origin database. Readwrite transactions serialize all queue transitions,
 * including the foreground fallback when Web Locks are unavailable.
 */
export async function openOfflineStore(options: StoreOptions) {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) throw new Error("Durable reader storage unavailable");
  const now = options.now ?? Date.now;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(
      options.name ?? "durtal-offline",
      OFFLINE_DATABASE_VERSION,
    );
    let failed = false;
    req.onblocked = () => {
      failed = true;
      reject(new Error("Reader database upgrade blocked by another tab"));
    };
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      for (const name of OFFLINE_STORES) {
        const store = req.result.objectStoreNames.contains(name)
          ? req.transaction!.objectStore(name)
          : req.result.createObjectStore(
              name,
              name === "outbox"
                ? { keyPath: "seq", autoIncrement: true }
                : { keyPath: "key" },
            );
        if (name === "outbox" && !store.indexNames.contains("operationId"))
          store.createIndex("operationId", "mutation.operationId", {
            unique: true,
          });
      }
    };
    req.onsuccess = () => {
      if (failed) req.result.close();
      else resolve(req.result);
    };
  });
  db.onversionchange = () => db.close();
  const channel =
    options.channel === undefined
      ? typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(`${db.name}:changes`)
      : options.channel;
  const listeners = new Map<string, Set<() => void>>();
  const notify = (ebookId: string, broadcast = true) => {
    for (const callback of listeners.get(ebookId.toLowerCase()) ?? []) {
      // A subscriber cannot change the result of an already committed write.
      try {
        callback();
      } catch {
        /* subscribers own their errors */
      }
    }
    if (broadcast) channel?.postMessage({ ebookId });
  };
  if (channel)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { ebookId?: unknown } | null;
      if (data && typeof data.ebookId === "string") notify(data.ebookId, false);
    };
  async function transaction<T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const tx = db.transaction(
      ["outbox", "annotations", "positions", "rejected"],
      mode,
    );
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error("Reader transaction aborted"));
      tx.onerror = () => {
        /* onabort reports failed writes */
      };
    });
    try {
      const result = await run(tx);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* transaction already aborted */
      }
      await done.catch(() => {});
      throw error;
    }
  }
  function validate(input: DurableInput): DurableInput {
    const mutation = validateMutation(input.mutation, {
      nowMs: now(),
      annotations: options.validateAnnotations,
    });
    if (
      mutation.kind === "annotations" &&
      mutation.body.deletes.length &&
      !input.annotation?.undo
    )
      throw new Error(
        "Durable deletes require the owner Undo state and snapshot",
      );
    if (input.annotation) {
      if (mutation.kind !== "annotations")
        throw new Error("Annotation local state on a position");
      const undo = input.annotation.undo;
      if (
        undo &&
        (mutation.body.upserts.length ||
          mutation.body.deletes.length !== 1 ||
          !["undoable", "sealed"].includes(undo.state) ||
          (undo.state === "undoable" &&
            (undo.until === null || !Number.isFinite(undo.until))) ||
          (undo.until !== null && !Number.isFinite(undo.until)) ||
          !undo.snapshot ||
          typeof undo.snapshot !== "object" ||
          undo.snapshot.id !== mutation.body.deletes[0].id ||
          undo.snapshot.ebookId !== mutation.ebookId ||
          undo.snapshot.fileId !== mutation.fileId)
      )
        throw new Error("Invalid durable annotation Undo state");
    }
    return clone({
      mutation,
      ...(input.annotation ? { annotation: input.annotation } : {}),
    });
  }
  async function rows(tx: IDBTransaction): Promise<StoredOperation[]> {
    const result = (await request(
      tx.objectStore("outbox").getAll(),
    )) as StoredOperation[];
    for (const row of result) {
      if (
        recordVersionPolicy(row) !== "supported" ||
        !["waiting", "claimed", "blocked"].includes(row.state) ||
        (row.retryAt !== null && !Number.isFinite(row.retryAt))
      )
        throw new Error("Unsupported or invalid durable outbox record");
      validate(row);
    }
    // Reuse ledger validation without selecting or changing any row.
    coalescePositions(result);
    return result;
  }
  async function receipt(
    tx: IDBTransaction,
    row: StoredOperation,
    outcome: Receipt["outcome"],
  ) {
    await request(
      tx.objectStore("annotations").put({
        v: 1,
        key: receiptKey(row.mutation.operationId),
        original: JSON.stringify(row.mutation),
        outcome,
      } satisfies Receipt),
    );
    await request(tx.objectStore("outbox").delete(row.seq));
  }
  async function insert(tx: IDBTransaction, input: DurableInput) {
    const queue = tx.objectStore("outbox"),
      annotations = tx.objectStore("annotations");
    const existing = (await request(
      queue.index("operationId").get(input.mutation.operationId),
    )) as StoredOperation | undefined;
    const settled = (await request(
      annotations.get(receiptKey(input.mutation.operationId)),
    )) as Receipt | undefined;
    if (
      settled &&
      (recordVersionPolicy(settled) !== "supported" ||
        typeof settled.original !== "string")
    )
      throw new Error("Unsupported durable operation receipt");
    if (existing || settled) {
      if (
        (existing ? JSON.stringify(existing.mutation) : settled!.original) !==
        original(input)
      )
        throw new Error("Durable operation identity collision");
      // Duplicate input cannot reset a claim, Undo deadline, seal or cancellation.
      return;
    }
    const row = {
      v: 1,
      mutation: input.mutation,
      attempts: 0,
      state: "waiting",
      claim: null,
      retryAt: null,
      ...(input.annotation ? { annotation: input.annotation } : {}),
    };
    await request(queue.add(row));
    if (input.mutation.kind === "position") {
      const key = mutationKey(input.mutation),
        positions = tx.objectStore("positions");
      const prior = (await request(positions.get(key))) as
        | LocalPosition
        | undefined;
      if (prior && recordVersionPolicy(prior) !== "supported")
        throw new Error("Unsupported local position");
      const candidates = [
        ...(prior ? [prior.milestone, prior.latest] : []),
        input.mutation,
      ];
      let latest = input.mutation,
        milestone = input.mutation;
      for (const candidate of candidates) {
        if (candidate.kind !== "position")
          throw new Error("Invalid local position kind");
        validate({ mutation: candidate });
        if (
          comparePositionTimes(
            candidate.body.clientUpdatedAt,
            latest.body.clientUpdatedAt,
          ) > 0
        )
          latest = candidate;
        if (
          candidate.body.locator.totalProgression >
            milestone.body.locator.totalProgression ||
          (candidate.body.locator.totalProgression ===
            milestone.body.locator.totalProgression &&
            comparePositionTimes(
              candidate.body.clientUpdatedAt,
              milestone.body.clientUpdatedAt,
            ) > 0)
        )
          milestone = candidate;
      }
      await request(
        positions.put({ v: 1, key, latest, milestone } satisfies LocalPosition),
      );
      const all = await rows(tx),
        plan = coalescePositions(all);
      for (const seq of plan.removeSeqs)
        await receipt(tx, all.find((item) => item.seq === seq)!, "coalesced");
    }
  }
  async function book(
    tx: IDBTransaction,
    ebookId: string,
  ): Promise<AnnotationBook> {
    const saved = (await request(
      tx.objectStore("annotations").get(bookKey(ebookId)),
    )) as BookRecord | undefined;
    if (saved && recordVersionPolicy(saved) !== "supported")
      throw new Error("Unsupported annotation book");
    return {
      annotations: saved?.annotations ?? [],
      cursor: saved?.cursor ?? null,
      pending: (await rows(tx)).filter(
        (row) =>
          row.mutation.kind === "annotations" &&
          row.mutation.ebookId.toLowerCase() === ebookId.toLowerCase(),
      ),
    };
  }
  async function saveBook(
    tx: IDBTransaction,
    ebookId: string,
    state: Pick<AnnotationBook, "annotations" | "cursor">,
  ) {
    await request(
      tx.objectStore("annotations").put({
        v: 1,
        key: bookKey(ebookId),
        annotations: clone(state.annotations),
        cursor: state.cursor,
      } satisfies BookRecord),
    );
  }
  return {
    async enqueue(input: DurableInput): Promise<void> {
      const valid = validate(input);
      await transaction("readwrite", (tx) => insert(tx, valid));
      notify(valid.mutation.ebookId);
    },
    readBook: (ebookId: string) =>
      transaction("readonly", (tx) => book(tx, ebookId)),
    /** The reducer is synchronous. Removing a pending operation means Undo and
     * is allowed only before its persisted deadline; claimed/sealed rows survive.
     * Added entries are validated and committed with the owner's local snapshot.
     */
    async transactBook(
      ebookId: string,
      reduce: (state: AnnotationBook) => {
        annotations: Json[];
        cursor: string | null;
        pending: DurableInput[];
      },
    ): Promise<AnnotationBook> {
      const result = await transaction("readwrite", async (tx) => {
        const current = await book(tx, ebookId),
          changed = reduce(clone(current));
        if (
          changed &&
          typeof (changed as unknown as Promise<unknown>).then === "function"
        )
          throw new Error("Annotation reducer must be synchronous");
        const keep = new Set(
          changed.pending.map((item) => item.mutation.operationId),
        );
        for (const row of current.pending)
          if (!keep.has(row.mutation.operationId)) {
            const undo = row.annotation?.undo;
            if (
              row.state !== "waiting" ||
              undo?.state !== "undoable" ||
              undo.until === null ||
              now() >= undo.until
            )
              throw new Error(
                "Cannot undo a sealed, claimed or expired annotation",
              );
            await receipt(tx, row, "undone");
          }
        for (const item of changed.pending) {
          const valid = validate(item);
          if (
            valid.mutation.kind !== "annotations" ||
            valid.mutation.ebookId.toLowerCase() !== ebookId.toLowerCase()
          )
            throw new Error(
              "Annotation transaction cannot mix books or positions",
            );
          await insert(tx, valid);
        }
        await saveBook(tx, ebookId, changed);
        return book(tx, ebookId);
      });
      notify(ebookId);
      return result;
    },
    readRejected: () =>
      transaction("readonly", (tx) =>
        request(tx.objectStore("rejected").getAll()),
      ),
    inspect: () => transaction("readonly", rows),
    readPosition: (key: string) =>
      transaction(
        "readonly",
        async (tx) =>
          (await request(tx.objectStore("positions").get(key))) as
            | LocalPosition
            | undefined,
      ),
    async claim(
      options: Parameters<typeof planReplayClaim>[1],
    ): Promise<StoreClaim> {
      return transaction("readwrite", async (tx) => {
        const all = await rows(tx),
          first = all[0];
        // Preserve the blocked head priority, including device changes.
        if (
          first?.state !== "blocked" &&
          first?.retryAt !== null &&
          first?.retryAt !== undefined &&
          first.retryAt > options.nowMs
        )
          return { kind: "stop", reason: "backoff" };
        const undoOpen = (row: StoredOperation) =>
          row.annotation?.undo?.state === "undoable" &&
          row.annotation.undo.until !== null &&
          row.annotation.undo.until > options.nowMs;
        const stop =
          options.mode === "foreground" ? all.findIndex(undoOpen) : -1;
        if (stop === 0 && first.state !== "blocked")
          return { kind: "stop", reason: "undo_pending" };
        const plan = planReplayClaim(
          stop > 0 ? all.slice(0, stop) : all,
          options,
        );
        if (plan.kind === "claim")
          for (const claimed of plan.rows) {
            const row = all.find((item) => item.seq === claimed.seq)!;
            const annotation = row.annotation
              ? {
                  ...row.annotation,
                  undo: row.annotation.undo
                    ? { ...row.annotation.undo, state: "sealed" as const }
                    : null,
                }
              : undefined;
            await request(
              tx.objectStore("outbox").put({
                ...row,
                ...claimed,
                ...(annotation ? { annotation } : {}),
              }),
            );
          }
        return plan;
      });
    },
    async settle(
      references: readonly OperationReference[],
      outcome: "acknowledged" | "blocked" | "retry" | "rejected" | "ignored",
      options: {
        reason?: string;
        retryAt?: number;
        ignored?: {
          seq: number;
          reason: string;
          items?: AnnotationItemOutcome[];
        }[];
        updateBook?: (
          ebookId: string,
          state: AnnotationBook,
        ) => Pick<AnnotationBook, "annotations" | "cursor">;
      } = {},
    ): Promise<number> {
      if (options.retryAt !== undefined && !Number.isFinite(options.retryAt))
        throw new Error("Invalid retry deadline");
      const books = new Set<string>();
      const affected = await transaction("readwrite", async (tx) => {
        const queue = tx.objectStore("outbox");
        let count = 0;
        for (const reference of references) {
          const row = (await request(queue.get(reference.seq))) as
            | StoredOperation
            | undefined;
          if (!row || !matchesClaim(row, reference)) continue;
          const ignored = options.ignored?.find((item) => item.seq === row.seq);
          const result =
            ignored && outcome === "acknowledged" ? "ignored" : outcome;
          if (result === "retry" || result === "blocked") {
            const released = releaseClaim(row, reference, result === "blocked");
            await request(
              queue.put({ ...released, retryAt: options.retryAt ?? null }),
            );
          } else {
            if (result !== "acknowledged")
              await request(
                tx.objectStore("rejected").put({
                  v: 1,
                  key: row.mutation.operationId,
                  row,
                  outcome: result,
                  items: ignored?.items ?? [],
                  reason:
                    ignored?.reason ?? options.reason ?? "Refused by server",
                }),
              );
            await receipt(tx, row, result);
          }
          books.add(row.mutation.ebookId);
          count++;
        }
        if (options.updateBook && count)
          for (const ebookId of books)
            await saveBook(
              tx,
              ebookId,
              options.updateBook(ebookId, await book(tx, ebookId)),
            );
        return count;
      });
      for (const ebookId of books) notify(ebookId);
      return affected;
    },
    async reconcile(
      reference: BlockedOperationReference,
      currentDeviceId: string | null,
    ): Promise<boolean> {
      const changed = await transaction("readwrite", async (tx) => {
        const queue = tx.objectStore("outbox"),
          row = (await request(queue.get(reference.seq))) as
            | StoredOperation
            | undefined;
        if (!row) return false;
        const waiting = reconcileBlocked(row, reference, currentDeviceId);
        if (waiting === row) return false;
        await request(queue.put({ ...waiting, retryAt: null }));
        return true;
      });
      if (changed) notify(reference.ebookId);
      return changed;
    },
    subscribe(ebookId: string, callback: () => void): () => void {
      const key = ebookId.toLowerCase(),
        set = listeners.get(key) ?? new Set();
      set.add(callback);
      listeners.set(key, set);
      return () => {
        set.delete(callback);
        if (!set.size) listeners.delete(key);
      };
    },
    close() {
      db.close();
      channel?.close();
      listeners.clear();
    },
  };
}
export type OfflineStore = Awaited<ReturnType<typeof openOfflineStore>>;
