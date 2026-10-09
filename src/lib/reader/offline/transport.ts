import {
  deviceReplayPolicy,
  EXPECTED_DEVICE_HEADER,
  type Json,
} from "./mutations";
import {
  annotationAcknowledgments,
  OUTBOX_CLAIM_MS,
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
  const token = options.token ?? (() => crypto.randomUUID());
  const visible = () => !win || win.document.visibilityState === "visible";
  const reachable = () => !win || win.navigator.onLine;
  let inFlight: Promise<void> | null = null,
    stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
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
      const head = (await options.store.inspect())[0];
      if (!head || head.state === "blocked") return;
      if (head.retryAt !== null && head.retryAt > now()) {
        schedule(head.retryAt - now());
        return;
      }
      let identity: Awaited<ReturnType<typeof preflight>>;
      try {
        identity = await deadline(preflight);
      } catch (error) {
        options.onError?.(error);
        schedule(replayDelay(head.attempts, true)!);
        return;
      }
      if (stopped) return;
      const ready =
        identity.authenticated &&
        deviceReplayPolicy(head.mutation.deviceId, identity.deviceId) ===
          "ready";
      const plan = await options.store.claim({
        visible: visible(),
        reachable: reachable(),
        currentDeviceId: ready ? identity.deviceId : head.mutation.deviceId,
        nowMs: now(),
        token: token(),
        mode,
      });
      if (plan.kind === "stop") {
        if (plan.reason === "undo_pending") {
          const until = head.annotation?.undo?.until;
          if (until !== null && until !== undefined)
            schedule(Math.max(1, until - now()));
        }
        return;
      }
      if (stopped) {
        await options.store.settle(plan.references, "retry");
        return;
      }
      if (!ready) {
        await options.store.settle(plan.references, "blocked");
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
          await options.store.settle(plan.references, "acknowledged");
        } else if (outcome === "inspect_annotations") {
          const decoded = options.decodeAnnotations(response.body, plan);
          const acks = annotationAcknowledgments(
            plan.references,
            decoded.outcomes,
          );
          await options.store.settle(plan.references, "acknowledged", {
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
          await options.store.settle(plan.references, "blocked");
          return;
        } else if (outcome === "reject") {
          await options.store.settle(plan.references, "rejected", {
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
    await options.store.settle(plan.references, "retry", {
      retryAt: now() + delay,
    });
    schedule(delay);
  }
  function requestReplay(mode: "foreground" | "lifecycle"): Promise<void> {
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
  const onPageHide = () => {
    clearTimer();
    void requestReplay("lifecycle").catch((error) => options.onError?.(error));
  };
  win?.document.addEventListener("visibilitychange", onVisibility);
  win?.addEventListener("online", kick);
  win?.addEventListener("pagehide", onPageHide);
  return {
    store: options.store,
    async enqueue(input: DurableInput) {
      await options.store.enqueue(input);
      kick();
    },
    requestReplay,
    /** The caller explicitly completed authentication reconciliation. This does
     * not run from online/visibility/device probes and never relabels originals.
     */
    async reconcile(reference: BlockedOperationReference) {
      const identity = await deadline(preflight);
      if (!identity.authenticated) return false;
      const changed = await options.store.reconcile(
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
