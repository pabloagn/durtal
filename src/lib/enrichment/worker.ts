import { sql } from "drizzle-orm";
import { resultRows } from "@/lib/harmonization/store";
import { databaseErrorCode } from "@/lib/db/errors";
import type { Db } from "@/lib/catalogue/work-store";
import type { EnrichmentJobKind } from "./model";
import {
  claimNextEnrichmentJob,
  enqueueEnrichmentJob,
  failEnrichmentJob,
  finishEnrichmentJob,
  releaseHeldEnrichmentJobs,
  renewEnrichmentJobLease,
} from "./jobs";
import { undoApplication } from "./claims";
import { QuotaStop, type SourceCache } from "./source-cache";
import { ENRICHMENT_STAGES, stagesFor, type EnrichmentStage, type StageContext, type StageJob } from "./stages";
import { SCOPE_PRIORITY, scopeCondition, type EnrichmentScope } from "./queue";

/*
 * The enrichment worker (SLN-464), run by hand from scripts/enrichment/worker.ts.
 * A run fetches its jobs' answers into the cache, outside any transaction,
 * then, with --apply only: (a0) releases the holds of its kinds, (a)-(c) runs
 * each stage's steps, (d) works its jobs one at a time, each claimed by id
 * and written in its own transaction. A source refusal during the fetch
 * stops it: then no job of the set is written, and the answers already
 * fetched stay in the cache for the next run.
 */

type Stages = Partial<Record<EnrichmentJobKind, EnrichmentStage>>;
/** One transaction on the script's postgres-js Drizzle connection */
const inTransaction = <T>(conn: Db, work: (tx: Db) => Promise<T>): Promise<T> =>
  conn.transaction((tx) => work(tx as unknown as Db));

/** A plan runs on a read-only session: a write there must fail (25006), and a probe that changes nothing checks it */
export async function assertReadOnly(conn: Db) {
  const refused = await inTransaction(conn, (tx) => tx.execute(sql`update works set updated_at = updated_at where false`)).then(
    () => false,
    (error: unknown) => databaseErrorCode(error) === "25006",
  );
  if (!refused) throw new Error("The database accepted a write in a read-only session; nothing ran");
}

export interface WorkerOptions {
  runId: string;
  /** Unique to this run: finish, fail and hold trust the job's locked_by */
  worker: string;
  kinds: EnrichmentJobKind[];
  apply: boolean;
  cache: SourceCache;
  pace?: number;
  contact?: string | null;
  /** Work slugs: only their jobs, and a book's cost-ceiling hold is released */
  only?: string[];
  limit?: number;
  stages?: Stages;
  /**
   * A second connection that renews a job's lease while its write runs (the
   * write holds the run's own connection), and how often
   */
  heartbeat?: { conn: Db; everyMs: number };
}

/** Renews the lease every few minutes, well inside JOB_LEASE_MINUTES */
export const HEARTBEAT_MS = 5 * 60_000;

export interface WorkerReport {
  lines: string[];
  /** Why the fetch stopped, or null */
  stopped: string | null;
  /** The jobs written, with their outcome or error */
  jobs: { id: string; slug: string | null; outcome?: Record<string, unknown>; error?: string; skipped?: string }[];
}

/** The run's job set: due queued jobs and the holds step (a0) releases, or the named books' jobs */
async function jobSet(conn: Db, kinds: EnrichmentJobKind[], only: string[] | undefined, limit: number | undefined) {
  const list = sql.join(kinds.map((k) => sql`${k}`), sql`, `);
  if (only?.length) {
    const known = resultRows<{ slug: string }>(
      await conn.execute(sql`select slug from works where kind = 'book' and slug in (${sql.join(only.map((s) => sql`${s}`), sql`, `)})`),
    ).map((r) => r.slug);
    const unknown = only.filter((s) => !known.includes(s));
    if (unknown.length) throw new Error(`Unknown book: ${unknown.join(", ")}`);
  }
  const scope = only?.length
    ? sql`w.slug in (${sql.join(only.map((s) => sql`${s}`), sql`, `)}) and j.status in ('queued', 'held')`
    : sql`((j.status = 'queued' and j.run_after <= now()) or (j.status = 'held' and j.held_reason in ('quota', 'rate_limited', 'budget')))`;
  return resultRows<StageJob>(
    await conn.execute(sql`select j.id, j.work_id as "workId", w.slug, w.title, j.kind, j.status, j.held_reason as "heldReason", j.priority, j.payload
      from enrichment_jobs j join works w on w.id = j.work_id
      where j.kind in (${list}) and ${scope}
      order by j.priority, j.run_after, j.id ${limit ? sql`limit ${limit}` : sql``}`),
  );
}

/**
 * One run: a plan by default, which writes nothing; with `apply`, steps
 * (a0) to (d). Every claim the run makes carries its id, and so does every
 * apply (as its batch).
 */
export async function runWorker(conn: Db, options: WorkerOptions): Promise<WorkerReport> {
  const stages = stagesFor(options.kinds, options.stages ?? ENRICHMENT_STAGES);
  const ctx: StageContext = { runId: options.runId, cache: options.cache, pace: options.pace ?? 1100, contact: options.contact ?? null };
  for (const stage of stages)
    if (stage.callsOut && !ctx.contact)
      throw new Error(`The ${stage.kind} stage calls outside services: set ENRICHMENT_CONTACT (the contact its User-Agent names) first`);
  const report: WorkerReport = { lines: [], stopped: null, jobs: [] };
  const set = await jobSet(conn, options.kinds, options.only, options.limit);

  // Fetch: the answers, outside any transaction; a refusal stops it here
  let fetched = 0;
  for (const stage of stages) {
    const jobs = set.filter((j) => j.kind === stage.kind);
    try {
      await stage.fetch(conn, jobs, ctx);
      fetched += jobs.length;
    } catch (error) {
      if (!(error instanceof QuotaStop)) throw error;
      report.stopped = error.message;
      break;
    }
  }
  if (report.stopped) report.lines.push(`Stopped after ${fetched} of ${set.length} jobs: ${report.stopped}`);

  const plans = new Map<string, { plan: unknown; summary: string }>();
  if (!report.stopped) {
    for (const job of set) plans.set(job.id, await stages.find((s) => s.kind === job.kind)!.plan(conn, job, ctx));
    for (const stage of stages)
      report.lines.push(...(stage.summarize?.(set.filter((j) => j.kind === stage.kind).map((j) => plans.get(j.id)!.plan)) ?? []));
  }

  if (!options.apply) {
    for (const stage of stages)
      for (const step of stage.steps) report.lines.push(`## ${step.name}`, ...(await step.plan(conn, ctx)));
    report.lines.push(`## Jobs (${set.length})`, ...set.map((j) => `- ${j.slug ?? j.workId}: ${plans.get(j.id)?.summary ?? "not fetched"}`));
    for (const stage of stages) if (stage.epilogue) report.lines.push(...(await stage.epilogue(conn)));
    return report;
  }

  // (a0) holds: quota, rate limit and budget; a named book's cost ceiling too
  for (const kind of options.kinds) {
    const released = await releaseHeldEnrichmentJobs(kind, conn, options.only?.length ? { jobIds: set.map((j) => j.id) } : {});
    if (released) report.lines.push(`Released ${released} held ${kind} jobs`);
  }
  // (a) to (c): each stage's steps, each in its own transaction
  for (const stage of stages)
    for (const step of stage.steps) report.lines.push(`## ${step.name}`, ...(await inTransaction(conn, (tx) => step.apply(tx, ctx))));
  // (d) the jobs, one at a time; none after a refused fetch
  if (!report.stopped)
    for (const job of set) {
      const stage = stages.find((s) => s.kind === job.kind)!;
      const claimed = await claimNextEnrichmentJob({ worker: options.worker, kinds: [job.kind], jobIds: [job.id] }, conn);
      if (!claimed) {
        report.jobs.push({ id: job.id, slug: job.slug, skipped: "taken by another worker or no longer due" });
        continue;
      }
      const beat = options.heartbeat
        ? setInterval(() => {
            renewEnrichmentJobLease({ id: job.id, worker: options.worker }, options.heartbeat!.conn).catch((error) =>
              console.error("[enrichment] Could not renew the lease of", job.id, error),
            );
          }, options.heartbeat.everyMs)
        : null;
      try {
        const outcome = await inTransaction(conn, async (tx) => {
          const result = await stage.write(tx, job, plans.get(job.id)!.plan, ctx);
          await finishEnrichmentJob({ id: job.id, worker: options.worker, outcome: result }, tx);
          return result;
        });
        report.jobs.push({ id: job.id, slug: job.slug, outcome });
      } catch (error) {
        await failEnrichmentJob({ id: job.id, worker: options.worker, error }, conn);
        report.jobs.push({ id: job.id, slug: job.slug, error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (beat) clearInterval(beat);
      }
    }
  report.lines.push(
    `## Jobs (${report.jobs.length} of ${set.length})`,
    ...report.jobs.map((j) => `- ${j.slug ?? j.id}: ${j.error ? `failed: ${j.error}` : j.skipped ? `skipped: ${j.skipped}` : JSON.stringify(j.outcome)}`),
  );
  for (const stage of stages) if (stage.epilogue) report.lines.push(...(await stage.epilogue(conn)));
  report.lines.push("", "After a live apply, refresh the app's cached data in Settings → Data.");
  return report;
}

/**
 * Undoes a run: its applies, newest first, each on its own, then each
 * stage's undo hook. An apply that changed since is refused with its reason.
 */
export async function undoRun(conn: Db, options: { runId: string; apply: boolean; stages?: Stages }) {
  const applies = resultRows<{ id: string; target: string; workId: string }>(
    await conn.execute(sql`select id, target, work_id as "workId" from enrichment_applications
      where batch_id = ${options.runId}::uuid and undone_at is null order by applied_at desc, id desc`),
  );
  const lines = [`Run ${options.runId}: ${applies.length} applies to undo`];
  if (!options.apply) return { lines, undone: [] as string[], refused: [] as { id: string; reason: string }[] };
  const undone: string[] = [];
  const refused: { id: string; reason: string }[] = [];
  for (const a of applies) {
    try {
      await undoApplication(a.id, conn);
      undone.push(a.id);
    } catch (error) {
      refused.push({ id: a.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const stage of Object.values(options.stages ?? ENRICHMENT_STAGES))
    if (stage) lines.push(...(await inTransaction(conn, (tx) => stage.undo(tx, options.runId))));
  lines.push(`Undid ${undone.length}; refused ${refused.length}`, ...refused.map((r) => `- ${r.id}: ${r.reason}`));
  return { lines, undone, refused };
}

/** Queues one job per book of a scope (or of the named books): counts only, unless `apply` */
export async function enqueueScope(conn: Db, options: { kind: EnrichmentJobKind; scope: EnrichmentScope; only?: string[]; apply: boolean }) {
  const named = options.only?.length ? sql`and w.slug in (${sql.join(options.only.map((s) => sql`${s}`), sql`, `)})` : sql``;
  const books = resultRows<{ id: string }>(
    await conn.execute(sql`select w.id from works w where w.kind = 'book' and ${scopeCondition(options.scope, sql`w.id`)} ${named} order by w.id`),
  );
  const lines = [`${options.scope}: ${books.length} books to queue for ${options.kind}`];
  if (options.apply)
    await inTransaction(conn, async (tx) => {
      for (const book of books)
        await enqueueEnrichmentJob({ workId: book.id, kind: options.kind, reason: "manual", priority: SCOPE_PRIORITY[options.scope] }, tx);
    });
  return { lines, books: books.length };
}
