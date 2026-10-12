import { z } from "zod/v4";
import { deviceClassSchema, resetReaderPreferencesSchema, updateReaderPreferencesSchema, presentationSchema } from "@/lib/validations/reader-preferences";
import { idSchema } from "@/lib/validations/helpers";
import type { PresentationRow } from "./defaults";
import { boundedPreferenceString, validateCachedPreferenceRows } from "./preference-cache";
import {
  applyPreferenceChanges, parsePreferenceReset, parsePreferenceUpdate,
  planPreferenceReset, planPreferenceUpdate, preferenceAdoptionSchema, scopedPreferenceRows,
  type PreferenceReply, type PreferenceReset, type PreferenceScope, type PreferenceUpdate,
} from "./preference-plan";

export const PREFERENCE_SAVE_DELAY_MS = 800;
const MAX_PENDING_JOBS = 128;
type DraftJob = { kind: "update"; input: PreferenceUpdate } | { kind: "reset"; input: PreferenceReset };
type Job = DraftJob & { generation: number };
export interface PreferenceRecovery {
  version: 1;
  scope: PreferenceScope;
  jobs: readonly DraftJob[];
}
export interface PreferenceSaverSnapshot {
  rows: readonly PresentationRow[];
  ready: boolean;
  /** Local reading admission is separate from real server adoption. */
  serverAdopted: boolean;
  saving: boolean;
  pending: number;
  error: string | null;
  recoveryError: string | null;
  recoverySaved: boolean;
  /** Dispatch on pagehide is not a server acknowledgement, even with a local draft. */
  unloadRisk: boolean;
}
export interface PreferenceTransport {
  update(input: PreferenceUpdate): Promise<PreferenceReply>;
  reset(input: PreferenceReset): Promise<PreferenceReply>;
  adopt(input: PreferenceScope): Promise<PreferenceReply>;
}

const recoverySchema = z.object({
  version: z.literal(1), scope: preferenceAdoptionSchema,
  jobs: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("update"), input: updateReaderPreferencesSchema }).strict(),
    z.object({ kind: z.literal("reset"), input: resetReaderPreferencesSchema }).strict(),
  ])).max(MAX_PENDING_JOBS),
}).strict();
const replyRowSchema = z.object({ deviceClass: deviceClassSchema, ebookId: idSchema.nullable(), presentation: presentationSchema.partial() }).strict();

export function createPreferenceSaver(options: {
  scope: PreferenceScope;
  initialRows: readonly PresentationRow[];
  transport: PreferenceTransport;
  recovery?: unknown;
  persistRecovery?: (draft: PreferenceRecovery | null) => void | Promise<void>;
  onAdopted?: () => void;
  online?: boolean;
  /** A verified downloaded book may open locally while adoption runs in the background. */
  localPreferenceAdmission?: boolean;
  cachedRows?: readonly PresentationRow[];
  cacheError?: string | null;
  persistAcknowledged?: (rows: readonly PresentationRow[]) => void | Promise<void>;
}) {
  const scope = Object.freeze(preferenceAdoptionSchema.parse(options.scope));
  let online = options.online !== false;
  let cacheError = options.cacheError ?? null;
  let localRows: readonly PresentationRow[] = [];
  if (options.cachedRows !== undefined) {
    try { localRows = validateCachedPreferenceRows(options.cachedRows, scope); }
    catch { cacheError = "Saved reading settings could not be loaded. Safe defaults are available offline."; }
  }
  let acknowledged = online && !options.localPreferenceAdmission ? scopedPreferenceRows(options.initialRows, scope.ebookId) : localRows;
  let jobs: readonly Job[] = [];
  let generation = 0;
  let through = 0;
  let activeGeneration: number | null = null;
  let ready = false;
  let serverAdopted = false;
  let locallyAdmitted = false;
  let networkEpoch = 0;
  let initializationEpoch = 0;
  let activated = false;
  let adoptionNotified = false;
  let error: string | null = null;
  let recoveryError: string | null = null;
  let recoverySaved = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadline: number | null = null;
  let initialization: Promise<void> | null = null;
  let running: Promise<void> | null = null;
  let flushRequested = false;
  let persistence: Promise<void> = Promise.resolve();
  let persistenceVersion = 0;
  const listeners = new Set<() => void>();

  function assertInputScope(input: PreferenceReset | PreferenceUpdate) {
    if (input.deviceClass !== scope.deviceClass || (input.ebookId !== null && input.ebookId !== scope.ebookId)
      || ("clearBookOverrideId" in input && input.clearBookOverrideId !== undefined && input.clearBookOverrideId !== scope.ebookId)) {
      throw new Error("Reading settings belong to a different device class or eBook.");
    }
  }

  function freezeJob(job: DraftJob, id: number): Job {
    assertInputScope(job.input);
    return Object.freeze({ ...job, generation: id, input: Object.freeze(job.kind === "update"
      ? { ...job.input, presentation: Object.freeze({ ...job.input.presentation }) }
      : { ...job.input }) }) as Job;
  }

  if (options.recovery !== undefined && options.recovery !== null) {
    try {
      boundedPreferenceString(options.recovery);
      const draft = recoverySchema.parse(options.recovery);
      if (draft.scope.deviceClass !== scope.deviceClass || draft.scope.ebookId !== scope.ebookId) throw new Error("Wrong recovery scope.");
      jobs = Object.freeze(draft.jobs.map((job) => freezeJob(job.kind === "update"
        ? { kind: "update", input: parsePreferenceUpdate(job.input) }
        : { kind: "reset", input: parsePreferenceReset(job.input) }, ++generation)));
      recoverySaved = jobs.length > 0;
    } catch {
      recoveryError = "A saved reading-settings draft could not be loaded. It has not been submitted.";
    }
  }

  function previewRows() {
    let rows = acknowledged;
    for (const job of jobs) rows = applyPreferenceChanges(rows,
      job.kind === "update" ? planPreferenceUpdate(rows, job.input) : planPreferenceReset(job.input));
    return scopedPreferenceRows(rows, scope.ebookId);
  }

  let snapshot: PreferenceSaverSnapshot = Object.freeze({ rows: previewRows(), ready, serverAdopted, saving: false,
    pending: jobs.length, error, recoveryError: recoveryError ?? cacheError, recoverySaved, unloadRisk: jobs.length > 0 });

  function publish() {
    snapshot = Object.freeze({ rows: previewRows(), ready, serverAdopted, saving: initialization !== null || running !== null,
      pending: jobs.length, error, recoveryError: recoveryError ?? cacheError, recoverySaved, unloadRisk: jobs.length > 0 });
    for (const listener of listeners) listener();
  }

  function persist(): Promise<void> {
    const version = ++persistenceVersion;
    if (!options.persistRecovery) { recoverySaved = false; return Promise.resolve(); }
    const stored = jobs.length > 0;
    const committed = () => {
      if (version !== persistenceVersion) return;
      recoverySaved = stored; recoveryError = null; publish();
    };
    const failed = (cause: unknown) => {
      if (version !== persistenceVersion) return;
      recoverySaved = false;
      recoveryError = cause instanceof Error && cause.message.includes("another tab") ? cause.message
        : "This browser could not keep an unsaved settings draft. Keep the page open until the save succeeds.";
      publish();
    };
    try {
      const result = options.persistRecovery(stored ? Object.freeze({ version: 1, scope,
        jobs: Object.freeze(jobs.map(({ kind, input }) => Object.freeze({ kind, input }) as DraftJob)) }) : null);
      if (result) {
        recoverySaved = false;
        persistence = Promise.resolve(result).then(committed, failed);
      } else { committed(); persistence = Promise.resolve(); }
    } catch (cause) { failed(cause); persistence = Promise.resolve(); }
    return persistence;
  }

  async function mergeReply(reply: PreferenceReply, expectedBook: string | null) {
    if (!reply.ok) throw new Error(reply.error);
    if (reply.deviceClass !== scope.deviceClass || reply.ebookId !== expectedBook || reply.rows.length > 6) throw new Error("Unexpected reading-settings save scope.");
    boundedPreferenceString(reply);
    const rows = reply.rows.map((row) => replyRowSchema.parse(row));
    const keys = new Set<string>();
    for (const row of rows) {
      if (row.ebookId !== null && row.ebookId !== expectedBook) throw new Error("Unexpected eBook in reading-settings reply.");
      const key = `${row.deviceClass}:${row.ebookId ?? "defaults"}`;
      if (keys.has(key)) throw new Error("Duplicate reading-settings reply scope.");
      keys.add(key);
    }
    // A defaults-only response is never authority to remove this book's override.
    const replacesBook = expectedBook !== null && expectedBook === scope.ebookId;
    acknowledged = scopedPreferenceRows([
      ...acknowledged.filter((row) => row.deviceClass !== scope.deviceClass || (row.ebookId !== null && !replacesBook)),
      ...rows.filter((row) => row.deviceClass === scope.deviceClass && (row.ebookId === null || replacesBook)),
    ], scope.ebookId);
    try { await options.persistAcknowledged?.(acknowledged); cacheError = null; }
    catch (cause) { cacheError = cause instanceof Error && cause.message.includes("another tab") ? cause.message
      : "This browser could not keep acknowledged reading settings for offline use."; }
  }

  function notifyAdoption() {
    if (!activated || !online || !serverAdopted || adoptionNotified) return;
    try { options.onAdopted?.(); adoptionNotified = true; }
    catch { recoveryError = "The old reading-settings cookie could not be cleared."; }
  }

  /** Explicit committed activation; construction and recovery parsing are inert. */
  function start(): Promise<void> {
    if (!activated) {
      activated = true;
      if (jobs.length) {
        deadline ??= Date.now() + PREFERENCE_SAVE_DELAY_MS;
        if (options.persistRecovery) void persist();
        schedule(false);
      }
    }
    if (options.localPreferenceAdmission) { locallyAdmitted = true; ready = true; }
    if (!online) {
      locallyAdmitted = true; ready = true;
      publish(); return Promise.resolve();
    }
    if (serverAdopted) { notifyAdoption(); publish(); return Promise.resolve(); }
    if (initialization) return initializationEpoch === networkEpoch ? initialization
      : initialization.then(() => activated && online ? start() : undefined);
    initializationEpoch = networkEpoch;
    const epoch = networkEpoch;
    error = null;
    initialization = Promise.resolve().then(async () => {
      try {
        if (!activated || !online) return;
        const reply = await options.transport.adopt(scope);
        // A pre-disconnect reply cannot replace the locally admitted snapshot.
        if (!online || epoch !== networkEpoch) return;
        await mergeReply(reply, scope.ebookId);
        serverAdopted = online && epoch === networkEpoch;
        ready = serverAdopted || locallyAdmitted;
        notifyAdoption();
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "Reading settings could not be loaded.";
      } finally { initialization = null; publish(); }
    });
    publish();
    return initialization;
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(newDeadline = true) {
    clearTimer();
    // A fresh edit establishes a new deadline, including after a request failure.
    flushRequested = false;
    if (newDeadline) deadline = Date.now() + PREFERENCE_SAVE_DELAY_MS;
    if (!activated || !online) return;
    timer = setTimeout(() => { timer = null; if (activated) void flush(); }, Math.max(0, (deadline ?? Date.now()) - Date.now()));
  }

  async function flush(): Promise<void> {
    if (!activated) return;
    if (!online) return persistence;
    clearTimer();
    through = Math.max(through, jobs[jobs.length - 1]?.generation ?? 0);
    if (running) { flushRequested = true; return running; }
    await start();
    await persistence;
    if (!activated || !online || !serverAdopted || jobs.length === 0) return;
    if (running) { flushRequested = true; return running; }
    flushRequested = false;
    running = Promise.resolve().then(async () => {
      try {
        while (activated && online && serverAdopted && jobs.length && jobs[0].generation <= through) {
          const job = jobs[0];
          activeGeneration = job.generation;
          error = null;
          publish();
          try {
            const reply = await (job.kind === "update" ? options.transport.update(job.input) : options.transport.reset(job.input));
            const book = job.kind === "update" ? job.input.ebookId ?? job.input.clearBookOverrideId ?? null : job.input.ebookId;
            await mergeReply(reply, book);
            jobs = Object.freeze(jobs.filter((item) => item.generation !== job.generation));
            await persist();
          } catch (cause) {
            error = cause instanceof Error ? cause.message : "Reading settings could not be saved.";
            break;
          } finally { activeGeneration = null; publish(); }
        }
      } finally {
        running = null;
        const retry = flushRequested;
        flushRequested = false;
        publish();
        // Only another explicit online/expired-debounce/flush event permits a retry.
        if (activated && online && retry && (!serverAdopted || jobs.length && jobs[0].generation <= through)) void flush();
      }
    });
    publish();
    return running;
  }

  function enqueue(job: DraftJob) {
    const tail = jobs[jobs.length - 1];
    if (job.kind === "update" && tail?.kind === "update" && tail.generation !== activeGeneration
      && tail.input.deviceClass === job.input.deviceClass && tail.input.ebookId === job.input.ebookId
      && tail.input.clearBookOverrideId === job.input.clearBookOverrideId) {
      jobs = Object.freeze([...jobs.slice(0, -1), freezeJob({ kind: "update", input: {
        ...job.input, presentation: { ...tail.input.presentation, ...job.input.presentation },
      } }, ++generation)]);
    } else {
      if (jobs.length >= MAX_PENDING_JOBS) throw new Error("Too many unsaved reading-setting changes. Save these before editing more.");
      jobs = Object.freeze([...jobs, freezeJob(job, ++generation)]);
    }
    error = null;
    persist();
    publish();
    schedule();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
    setOnline(value: boolean) {
      if (online === value) return;
      online = value;
      if (!online) {
        if (!serverAdopted && !locallyAdmitted) acknowledged = localRows;
        networkEpoch++; serverAdopted = false; locallyAdmitted = true; ready = true;
        clearTimer(); flushRequested = false;
      }
      publish();
    },
    /** Cleanup pauses future work; dispatched writes may acknowledge, drafts survive. */
    pause() { activated = false; clearTimer(); flushRequested = false; },
    update(input: unknown) { enqueue({ kind: "update", input: parsePreferenceUpdate(input) }); },
    reset(input: unknown) { enqueue({ kind: "reset", input: parsePreferenceReset(input) }); },
    /** Best effort; pending remains recoverable until an actual scoped acknowledgement. */
    flush,
  };
}

export type PreferenceSaver = ReturnType<typeof createPreferenceSaver>;
