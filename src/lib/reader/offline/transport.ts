import { readerUuid } from "@/lib/reader/uuid";
import {
  deviceReplayPolicy,
  EXPECTED_DEVICE_HEADER,
  type Json,
  mutationWireJson,
} from "./mutations";
import {
  annotationAcknowledgments,
  comparePositionTimes,
  OUTBOX_CLAIM_MS,
  OUTBOX_KEEPALIVE_BYTES,
  planReplayClaim,
  replayDelay,
  replayOutcome,
  type AnnotationItemOutcome,
  type BlockedOperationReference,
  type ClaimPlan,
} from "./outbox-policy";
import {
  type AnnotationBook,
  type DurableInput,
  type OfflineStore,
  type StoredOperation,
} from "./store";

export interface ReplayResponse {
  status: number;
  body: unknown;
  code?: string;
  retryAfterMs?: number;
}
export type ClaimedPlan = Extract<ClaimPlan, { kind: "claim" }>;
export interface TransportOptions {
  store: OfflineStore;
  /** Owners validate their response; HTML redirects and malformed 2xx never ack. */
  positionAcknowledged: (body: unknown) => boolean;
  decodeAnnotations: (
    body: unknown,
    plan: ClaimedPlan,
  ) => {
    outcomes: AnnotationItemOutcome[];
    updateBook?: (
      ebookId: string,
      current: AnnotationBook,
    ) => Pick<AnnotationBook, "annotations" | "cursor">;
  };
  fetch?: typeof fetch;
  preflight?: (
    signal: AbortSignal,
  ) => Promise<{ deviceId: string | null; authenticated: boolean }>;
  send?: (
    plan: ClaimedPlan,
    signal: AbortSignal,
    mode: "foreground" | "lifecycle",
  ) => Promise<ReplayResponse>;
  locks?: Pick<LockManager, "request"> | null;
  window?: Window | null;
  now?: () => number;
  token?: () => string;
  onError?: (error: unknown) => void;
}
/** Positions and annotations use this sole replay coordinator online and offline.
 * An enqueue promise is a durable commit, never an HTTP delivery receipt.
 */
export function createReaderTransport(options: TransportOptions) {
  const now = options.now ?? Date.now;
  const win =
    options.window === undefined
      ? typeof window === "undefined"
        ? null
        : window
      : options.window;
  const locks =
    options.locks === undefined
      ? (win?.navigator.locks ?? null)
      : options.locks;
  const doFetch = options.fetch ?? globalThis.fetch;
  const token = options.token ?? (() => readerUuid());
  const visible = () => !win || win.document.visibilityState === "visible";
  const reachable = () => !win || win.navigator.onLine;
  let inFlight: Promise<void> | null = null,
    stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let probedBlocked = false;
  // The queue as last read, for a closing page that cannot wait for
  // IndexedDB (SLN-869). It is dropped while a book transaction, which can
  // take an operation back (Undo), is under way, and read again after it.
  let lastRows: StoredOperation[] | null = null,
    rowsVersion = 0,
    undoing = 0;
  const ownTokens = new Set<string>();
  const remember = (rows: StoredOperation[], version: number) => {
    if (version === rowsVersion && !undoing) lastRows = rows;
  };
  const reread = () => {
    const version = rowsVersion;
    options.store
      .inspect()
      .then((rows) => remember(rows, version))
      .catch(() => {});
  };
  /** A new operation is read again once it commits, as a replay may already
   * be under way. A book transaction (Undo among them) forgets the queue
   * until it commits. Every other change is followed by a replay, which reads
   * the queue anyway. */
  const store: OfflineStore = {
    ...options.store,
    enqueue: (input) => options.store.enqueue(input).finally(reread),
    async transactBook(ebookId, reduce) {
      undoing++;
      rowsVersion++;
      lastRows = null;
      try {
        return await options.store.transactBook(ebookId, reduce);
      } finally {
        undoing--;
        rowsVersion++;
        reread();
      }
    },
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = (delay: number) => {
    clearTimer();
    if (!stopped && visible())
      timer = setTimeout(() => {
        timer = null;
        kick();
      }, delay);
  };
  const preflight =
    options.preflight ??
    (async (signal: AbortSignal) => {
      const response = await doFetch("/api/reader/device", {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal,
      });
      if (response.status === 401 || response.status === 403)
        return { deviceId: null, authenticated: false };
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        throw new Error("Device preflight unavailable");
      const body = (await response.json()) as { deviceId?: unknown };
      return {
        deviceId: typeof body.deviceId === "string" ? body.deviceId : null,
        authenticated: true,
      };
    });
  const send =
    options.send ??
    (async (
      plan: ClaimedPlan,
      signal: AbortSignal,
      mode: "foreground" | "lifecycle",
    ) => {
      const first = plan.rows[0].mutation;
      const response = await doFetch(
        `/api/reader/${first.ebookId}/${first.kind === "position" ? "position" : "annotations"}`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            [EXPECTED_DEVICE_HEADER]: first.deviceId,
          },
          body: plan.json,
          keepalive: mode === "lifecycle",
          signal,
        },
      );
      const body: unknown = response.headers
        .get("content-type")
        ?.includes("application/json")
        ? await response.json()
        : null;
      const code =
        body &&
        typeof body === "object" &&
        "code" in body &&
        typeof body.code === "string"
          ? body.code
          : undefined;
      const retry = response.headers.get("retry-after");
      const retryAfterMs =
        retry && /^\d+$/.test(retry)
          ? Math.min(Number(retry) * 1000, 300_000)
          : undefined;
      return { status: response.status, body, code, retryAfterMs };
    });
  /** Abort and bound even an injected transport that ignores its signal. */
  async function deadline<T>(
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const local = new AbortController();
    controller = local;
    let expiry: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      local.signal.addEventListener(
        "abort",
        () => reject(new Error("Reader request aborted")),
        { once: true },
      );
      expiry = setTimeout(() => {
        local.abort();
        reject(new Error("Reader request deadline elapsed"));
      }, OUTBOX_CLAIM_MS - 1000);
    });
    try {
      return await Promise.race([work(local.signal), timeout]);
    } finally {
      if (expiry) clearTimeout(expiry);
      if (controller === local) controller = null;
    }
  }
  async function replay(mode: "foreground" | "lifecycle") {
    while (!stopped && reachable() && (visible() || mode === "lifecycle")) {
      const version = rowsVersion;
      const rows = await store.inspect();
      remember(rows, version);
      const head = rows[0];
      if (!head) return;
      // A blocked head is probed once per page, only to learn whether its
      // device id was superseded; it is never sent from here.
      if (head.state === "blocked") {
        if (probedBlocked) return;
        probedBlocked = true;
      }
      if (
        head.state === "claimed" &&
        head.claim &&
        head.claim.expiresAt > now()
      ) {
        schedule(head.claim.expiresAt - now());
        return;
      }
      if (
        head.state !== "blocked" &&
        head.retryAt !== null &&
        head.retryAt > now()
      ) {
        schedule(head.retryAt - now());
        return;
      }
      let identity: Awaited<ReturnType<typeof preflight>>;
      try {
        identity = await deadline(preflight);
      } catch (error) {
        options.onError?.(error);
        if (head.state !== "blocked") schedule(replayDelay(head.attempts, true)!);
        return;
      }
      if (stopped) return;
      // A superseded device id in this browser, such as the loser of two
      // reader tabs opened at once, moves to the cookie's id instead of
      // blocking the queue for good (SLN-668).
      if (
        identity.authenticated &&
        identity.deviceId &&
        deviceReplayPolicy(head.mutation.deviceId, identity.deviceId) ===
          "device_identity_changed"
      ) {
        if (
          await store.adoptDevice(
            head.mutation.deviceId,
            identity.deviceId,
          )
        )
          continue;
        return;
      }
      if (head.state === "blocked") return;
      const ready =
        identity.authenticated &&
        deviceReplayPolicy(head.mutation.deviceId, identity.deviceId) ===
          "ready";
      const claimToken = token();
      ownTokens.add(claimToken);
      const plan = await store.claim({
        visible: visible(),
        reachable: reachable(),
        currentDeviceId: ready ? identity.deviceId : head.mutation.deviceId,
        nowMs: now(),
        token: claimToken,
        mode,
      });
      if (plan.kind === "stop") {
        if (plan.reason === "busy") {
          // A peer may have acquired the head after our initial inspection.
          // Read its persisted lease, never an old claim snapshot or later row.
          const current = (await store.inspect())[0];
          if (current?.state === "claimed" && current.claim)
            schedule(Math.max(1, current.claim.expiresAt - now()));
        }
        if (plan.reason === "undo_pending") {
          const until = head.annotation?.undo?.until;
          if (until !== null && until !== undefined)
            schedule(Math.max(1, until - now()));
        }
        return;
      }
      if (stopped) {
        await store.settle(plan.references, "retry");
        return;
      }
      if (!ready) {
        await store.settle(plan.references, "blocked");
        return;
      }
      try {
        const response = await deadline((signal) => send(plan, signal, mode));
        const outcome = replayOutcome(
          response.status,
          response.code,
          plan.rows[0].mutation.kind,
        );
        if (outcome === "acknowledge") {
          if (!options.positionAcknowledged(response.body))
            throw new Error("Invalid position acknowledgment");
          await store.settle(plan.references, "acknowledged");
        } else if (outcome === "inspect_annotations") {
          const decoded = options.decodeAnnotations(response.body, plan);
          const acks = annotationAcknowledgments(
            plan.references,
            decoded.outcomes,
          );
          await store.settle(plan.references, "acknowledged", {
            updateBook: decoded.updateBook,
            ignored: acks
              .filter((ack) => ack.ignored.length)
              .map((ack) => ({
                seq: ack.reference.seq,
                reason: ack.ignored.map((item) => item.reason!).join("; "),
                items: ack.ignored,
              })),
          });
        } else if (outcome === "blocked") {
          await store.settle(plan.references, "blocked");
          return;
        } else if (outcome === "reject") {
          await store.settle(plan.references, "rejected", {
            reason: response.code ?? `HTTP ${response.status}`,
          });
        } else {
          await retry(plan, response.retryAfterMs);
          return;
        }
      } catch (error) {
        options.onError?.(error);
        await retry(plan);
        return;
      }
      // One bounded keepalive body per lifecycle invocation. No beacon can carry
      // the required expected-device header or return an exact acknowledgment.
      if (mode === "lifecycle") return;
    }
  }
  async function retry(plan: ClaimedPlan, retryAfterMs?: number) {
    const delay = replayDelay(plan.rows[0].attempts, true, retryAfterMs)!;
    await store.settle(plan.references, "retry", {
      retryAt: now() + delay,
    });
    schedule(delay);
  }
  async function requestReplay(mode: "foreground" | "lifecycle"): Promise<void> {
    if (stopped) return;
    // Even an existing foreground request, unavailable identity or oversized
    // lifecycle body must not leave hidden delete intents Undo-able.
    await store.sealDeletes(mode);
    return startReplay(mode);
  }
  function startReplay(mode: "foreground" | "lifecycle"): Promise<void> {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    clearTimer();
    const run = () => replay(mode);
    const flight = (
      locks
        ? Promise.resolve(
            locks.request("durtal-offline:replay", { mode: "exclusive" }, () =>
              run(),
            ),
          ).then(() => {})
        : run()
    ).finally(() => {
      inFlight = null;
    });
    inFlight = flight;
    return flight;
  }
  function kick() {
    void requestReplay("foreground").catch((error) => options.onError?.(error));
  }
  const onVisibility = () => {
    if (!visible()) onPageHide();
    else kick();
  };
  /** The newest reading place the head plan leaves behind. While a delete
   * waits out its Undo window, the place of every page turned after it
   * queues behind it, and the closing page sent only the delete (SLN-919).
   * The server keeps the newest place by time, so it can go alongside, when
   * the two bodies fit the keepalive budget together. */
  function closingPosition(
    rows: readonly StoredOperation[],
    head: ClaimedPlan,
    at: number,
  ): ClaimedPlan | null {
    const sent = new Set(head.rows.map((row) => row.seq)),
      first = head.rows[0].mutation;
    const newer = (row: StoredOperation, than: StoredOperation["mutation"]) => {
      if (row.mutation.kind !== "position" || than.kind !== "position")
        return than.kind !== "position";
      const order = comparePositionTimes(
        row.mutation.body.clientUpdatedAt,
        than.body.clientUpdatedAt,
      );
      return (
        order > 0 ||
        (order === 0 &&
          row.mutation.body.locator.totalProgression >
            than.body.locator.totalProgression)
      );
    };
    let newest: StoredOperation | null = null;
    for (const row of rows)
      if (
        row.mutation.kind === "position" &&
        !sent.has(row.seq) &&
        row.state === "waiting" &&
        (row.retryAt === null || row.retryAt <= at) &&
        row.mutation.deviceId.toLowerCase() === first.deviceId.toLowerCase() &&
        newer(row, newest?.mutation ?? first)
      )
        newest = row;
    if (!newest) return null;
    const plan = planReplayClaim([newest], {
      visible: false,
      reachable: true,
      currentDeviceId: first.deviceId,
      nowMs: at,
      token: token(),
      mode: "lifecycle",
    });
    const size = (json: string) => new TextEncoder().encode(json).byteLength;
    return plan.kind === "claim" &&
      size(head.json) + size(plan.json) <= OUTBOX_KEEPALIVE_BYTES
      ? plan
      : null;
  }
  /** A closing page does not live to finish the device check and IndexedDB
   * work of a replay, so a delete still in its Undo window was lost until the
   * reader opened again on this device (SLN-869). It sends the head of the
   * queue as last read at once, in one keepalive body, unclaimed, and the
   * newest reading place behind it in a second (SLN-919). The server
   * applies each operation once by its id, so the replay that follows on a
   * later visit, or one that got further on this page, is acknowledged
   * without applying anything twice. The device header still has to match
   * the cookie on the server.
   */
  function sendWhileClosing(): boolean {
    const rows = lastRows,
      head = rows?.[0],
      at = now();
    if (!rows || !head || stopped || !reachable()) return false;
    if (head.state === "blocked" || (head.retryAt !== null && head.retryAt > at))
      return false;
    // Claims this page holds or that have lapsed are free; a live claim of
    // another page stays with that page.
    const free = rows.map((row) =>
      row.state === "claimed" &&
      row.claim &&
      (ownTokens.has(row.claim.token) || row.claim.expiresAt <= at)
        ? { ...row, state: "waiting" as const, claim: null }
        : row,
    );
    const plan = planReplayClaim(free, {
      visible: false,
      reachable: true,
      currentDeviceId: head.mutation.deviceId,
      nowMs: at,
      token: token(),
      mode: "lifecycle",
    });
    if (plan.kind !== "claim") return false;
    const place = closingPosition(free, plan, at);
    for (const each of place ? [plan, place] : [plan])
      send(each, new AbortController().signal, "lifecycle").catch((error) =>
        options.onError?.(error),
      );
    return true;
  }
  const onPageHide = (event?: Event) => {
    clearTimer();
    // A page kept for the back button (persisted) may come back and finish
    // its own replay.
    if (
      event?.type === "pagehide" &&
      !(event as Partial<PageTransitionEvent>).persisted &&
      sendWhileClosing()
    ) {
      void store
        .sealDeletes("lifecycle")
        .catch((error) => options.onError?.(error));
      return;
    }
    void requestReplay("lifecycle").catch((error) => options.onError?.(error));
  };
  win?.document.addEventListener("visibilitychange", onVisibility);
  win?.addEventListener("online", kick);
  win?.addEventListener("pagehide", onPageHide);
  // A reopened visible page may already be online, so no event wakes its
  // persisted queue. Reuse foreground replay and its Undo/device/claim guards.
  if (win && visible()) kick();
  return {
    store,
    async enqueue(input: DurableInput) {
      await store.enqueue(input);
      kick();
    },
    requestReplay,
    /** The reader's Retry while sync is paused (SLN-668): a blocked head is
     * probed again, and a waiting one goes now instead of after its backoff. */
    async retryNow() {
      if (stopped) return;
      probedBlocked = false;
      // A person pressing Retry is the explicit reconciliation a blocked head
      // waits for: signed in again under this device, it can go (review #273)
      const head = (await store.inspect())[0];
      if (head?.state === "blocked") {
        try {
          const identity = await deadline(preflight);
          if (identity.authenticated)
            await store.reconcile(
              {
                seq: head.seq,
                operationId: head.mutation.operationId,
                revision: head.mutation.revision,
                ebookId: head.mutation.ebookId,
                fileId: head.mutation.fileId,
                deviceId: head.mutation.deviceId,
                attempts: head.attempts,
                wireJson: mutationWireJson(head.mutation),
              },
              identity.deviceId,
            );
        } catch (error) {
          options.onError?.(error);
        }
      }
      await store.retryNow();
      return requestReplay("foreground");
    },
    /** The caller explicitly completed authentication reconciliation. This does
     * not run from online/visibility/device probes and never relabels originals;
     * only replay moves rows from a superseded device id to the current one.
     */
    async reconcile(reference: BlockedOperationReference) {
      const identity = await deadline(preflight);
      if (!identity.authenticated) return false;
      const changed = await store.reconcile(
        reference,
        identity.deviceId,
      );
      if (changed) kick();
      return changed;
    },
    destroy() {
      stopped = true;
      clearTimer();
      controller?.abort();
      win?.document.removeEventListener("visibilitychange", onVisibility);
      win?.removeEventListener("online", kick);
      win?.removeEventListener("pagehide", onPageHide);
    },
  };
}
export type ReaderTransport = ReturnType<typeof createReaderTransport>;

/** Direct structural adapter for SLN-500's AnnotationTransport. Its existing
 * serializer/domain policies remain injected; no annotation-only queue exists.
 */
export function createAnnotationTransport<Operation, Annotation, Pending>(
  transport: ReaderTransport,
  codec: {
    encodeOperation: (operation: Readonly<Operation>) => DurableInput;
    decodeAnnotation: (value: Json) => Annotation;
    encodeAnnotation: (value: Annotation) => Json;
    decodePending: (row: StoredOperation) => Pending;
    encodePending: (value: Pending) => DurableInput;
  },
) {
  type Book = {
    annotations: readonly Annotation[];
    cursor: string | null;
    pending: readonly Pending[];
  };
  const decode = (book: AnnotationBook): Book => ({
    annotations: book.annotations.map(codec.decodeAnnotation),
    cursor: book.cursor,
    pending: book.pending.map(codec.decodePending),
  });
  return {
    enqueue: (operation: Readonly<Operation>) =>
      transport.enqueue(codec.encodeOperation(operation)),
    readBook: async (ebookId: string) =>
      decode(await transport.store.readBook(ebookId)),
    transactBook: async (ebookId: string, reduce: (current: Book) => Book) =>
      decode(
        await transport.store.transactBook(ebookId, (current) => {
          const changed = reduce(decode(current));
          if (
            changed &&
            typeof (changed as unknown as Promise<unknown>).then === "function"
          )
            throw new Error("Annotation reducer must be synchronous");
          return {
            annotations: changed.annotations.map(codec.encodeAnnotation),
            cursor: changed.cursor,
            pending: changed.pending.map(codec.encodePending),
          };
        }),
      ),
    requestReplay: transport.requestReplay,
    subscribe: transport.store.subscribe,
  };
}
