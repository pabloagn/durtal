import { z } from "zod/v4";
import { deviceClassSchema, resetReaderPreferencesSchema, updateReaderPreferencesSchema } from "@/lib/validations/reader-preferences";
import { idSchema } from "@/lib/validations/helpers";
import type { PresentationRow } from "./defaults";
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
const replyRowSchema = z.object({ deviceClass: deviceClassSchema, ebookId: idSchema.nullable(), presentation: z.unknown() }).strict();

export function createPreferenceSaver(options: {
  scope: PreferenceScope;
  initialRows: readonly PresentationRow[];
  transport: PreferenceTransport;
  recovery?: unknown;
  persistRecovery?: (draft: PreferenceRecovery | null) => void;
  onAdopted?: () => void;
}) {
  const scope = Object.freeze(preferenceAdoptionSchema.parse(options.scope));
  let acknowledged = scopedPreferenceRows(options.initialRows, scope.ebookId);
  let jobs: readonly Job[] = [];
  let generation = 0;
  let through = 0;
  let activeGeneration: number | null = null;
  let ready = false;
  let error: string | null = null;
  let recoveryError: string | null = null;
  let recoverySaved = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let initialization: Promise<void> | null = null;
  let running: Promise<void> | null = null;
  let flushRequested = false;
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

  let snapshot: PreferenceSaverSnapshot = Object.freeze({ rows: previewRows(), ready, saving: false,
    pending: jobs.length, error, recoveryError, recoverySaved, unloadRisk: jobs.length > 0 });

  function publish() {
    snapshot = Object.freeze({ rows: previewRows(), ready, saving: initialization !== null || running !== null,
      pending: jobs.length, error, recoveryError, recoverySaved, unloadRisk: jobs.length > 0 });
    for (const listener of listeners) listener();
  }

  function persist() {
    if (!options.persistRecovery) { recoverySaved = false; return; }
    try {
      options.persistRecovery(jobs.length ? Object.freeze({ version: 1, scope,
        jobs: Object.freeze(jobs.map(({ kind, input }) => Object.freeze({ kind, input }) as DraftJob)) }) : null);
      recoverySaved = jobs.length > 0;
      recoveryError = null;
    } catch {
      recoverySaved = false;
      recoveryError = "This browser could not keep an unsaved settings draft. Keep the page open until the save succeeds.";
    }
  }

  function mergeReply(reply: PreferenceReply, expectedBook: string | null) {
    if (!reply.ok) throw new Error(reply.error);
    if (reply.deviceClass !== scope.deviceClass || reply.ebookId !== expectedBook || reply.rows.length > 6) throw new Error("Unexpected reading-settings save scope.");
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
  }

  function start(): Promise<void> {
    if (ready) return Promise.resolve();
    if (initialization) return initialization;
    error = null;
    initialization = Promise.resolve().then(async () => {
      try {
        mergeReply(await options.transport.adopt(scope), scope.ebookId);
        ready = true;
        try { options.onAdopted?.(); } catch { recoveryError = "The old reading-settings cookie could not be cleared."; }
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

  function schedule() {
    clearTimer();
    // A fresh edit establishes a new deadline, including after a request failure.
    flushRequested = false;
    timer = setTimeout(() => { timer = null; void flush(); }, PREFERENCE_SAVE_DELAY_MS);
  }

  async function flush(): Promise<void> {
    clearTimer();
    through = Math.max(through, jobs[jobs.length - 1]?.generation ?? 0);
    if (running) { flushRequested = true; return running; }
    await start();
    if (!ready || jobs.length === 0) return;
    if (running) { flushRequested = true; return running; }
    flushRequested = false;
    running = Promise.resolve().then(async () => {
      try {
        while (jobs.length && jobs[0].generation <= through) {
          const job = jobs[0];
          activeGeneration = job.generation;
          error = null;
          publish();
          try {
            const reply = await (job.kind === "update" ? options.transport.update(job.input) : options.transport.reset(job.input));
            const book = job.kind === "update" ? job.input.ebookId ?? job.input.clearBookOverrideId ?? null : job.input.ebookId;
            mergeReply(reply, book);
            jobs = Object.freeze(jobs.filter((item) => item.generation !== job.generation));
            persist();
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
        if (retry && jobs.length && jobs[0].generation <= through) void flush();
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

  if (jobs.length) schedule();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
    update(input: unknown) { enqueue({ kind: "update", input: parsePreferenceUpdate(input) }); },
    reset(input: unknown) { enqueue({ kind: "reset", input: parsePreferenceReset(input) }); },
    /** Best effort; pending remains recoverable until an actual scoped acknowledgement. */
    flush,
  };
}

export type PreferenceSaver = ReturnType<typeof createPreferenceSaver>;
