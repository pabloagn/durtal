import { sql } from "drizzle-orm";
import { db as appDb } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import type { Db } from "@/lib/catalogue/work-store";
import {
  claimJobSchema,
  enqueueJobSchema,
  heldReasonSchema,
  jobKindSchema,
  type EnqueueJobInput,
} from "@/lib/validations/enrichment";
import { OPEN_JOB_STATUSES, sqlList, type EnrichmentJobKind } from "./model";
import { JOB_LEASE_MINUTES, MAX_JOB_ATTEMPTS, jobError } from "./rules";

/*
 * The enrichment job queue (SLN-462): one table, claimed with SKIP LOCKED in
 * one statement, because the app's Neon HTTP driver has no interactive
 * transactions. A script on the Mac works it (SLN-464).
 */

export interface EnrichmentJob {
  id: string;
  workId: string;
  kind: EnrichmentJobKind;
  status: "queued" | "running" | "done" | "failed" | "held";
  priority: number;
  attempts: number;
  runAfter: string;
  lockedBy: string | null;
  heldReason: string | null;
  lastError: string | null;
  payload: Record<string, unknown>;
  rerun: boolean;
}
const JOB = sql`id, work_id as "workId", kind, status, priority, attempts, run_after::text as "runAfter", locked_by as "lockedBy",
  held_reason as "heldReason", last_error as "lastError", payload, rerun`;
const OPEN = sql.raw(sqlList(OPEN_JOB_STATUSES));
const one = async (conn: Db, query: ReturnType<typeof sql>) =>
  resultRows<EnrichmentJob>(await conn.execute(query))[0] ?? null;

/**
 * Queues a job, or folds it into the open job of that book and kind: the
 * dimension keys join, the earlier start wins, and a running job runs again
 * when it finishes.
 */
export async function enqueueEnrichmentJob(input: EnqueueJobInput, conn: Db = appDb) {
  const job = enqueueJobSchema.parse(input);
  const payload = {
    reason: job.reason,
    dimensions: [...new Set(job.dimensions)].sort(),
    ...(job.vocabularyVersion ? { vocabularyVersion: job.vocabularyVersion } : {}),
  };
  return one(
    conn,
    sql`insert into enrichment_jobs as j (work_id, kind, priority, run_after, payload)
      values (${job.workId}::uuid, ${job.kind}, ${job.priority}, coalesce(${job.runAfter?.toISOString() ?? null}::timestamptz, now()), ${JSON.stringify(payload)}::jsonb)
      on conflict (work_id, kind) where status in (${OPEN}) do update set
        payload = j.payload || jsonb_build_object('dimensions', (
          select coalesce(jsonb_agg(distinct d order by d), '[]'::jsonb)
          from jsonb_array_elements_text(coalesce(j.payload -> 'dimensions', '[]'::jsonb) || (excluded.payload -> 'dimensions')) d)),
        run_after = least(j.run_after, excluded.run_after),
        priority = least(j.priority, excluded.priority),
        rerun = j.rerun or j.status = 'running',
        updated_at = now()
      returning ${JOB}`,
  );
}

/**
 * Claims the next job for a worker: a queued job whose start has passed, by
 * priority then start, or a running one whose lease is abandoned. Every claim
 * counts an attempt. An abandoned job with every attempt spent fails instead,
 * and the next job is tried. With `jobIds` or `workIds`, only those.
 */
export async function claimNextEnrichmentJob(input: { worker: string; kinds: EnrichmentJobKind[]; jobIds?: string[]; workIds?: string[] }, conn: Db = appDb) {
  const { worker, kinds, jobIds, workIds } = claimJobSchema.parse(input);
  for (;;) {
    const job = await one(
      conn,
      sql`update enrichment_jobs j set
          status = case when j.status = 'running' and j.attempts >= ${MAX_JOB_ATTEMPTS} then 'failed' else 'running' end,
          last_error = case when j.status = 'running' and j.attempts >= ${MAX_JOB_ATTEMPTS} then 'abandoned lease' else j.last_error end,
          finished_at = case when j.status = 'running' and j.attempts >= ${MAX_JOB_ATTEMPTS} then now() end,
          locked_at = case when j.status = 'running' and j.attempts >= ${MAX_JOB_ATTEMPTS} then null else now() end,
          locked_by = case when j.status = 'running' and j.attempts >= ${MAX_JOB_ATTEMPTS} then null else ${worker} end,
          attempts = case when j.status = 'running' and j.attempts >= ${MAX_JOB_ATTEMPTS} then j.attempts else j.attempts + 1 end,
          updated_at = now()
        where j.id = (
          select id from enrichment_jobs
          where kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
            ${jobIds ? sql`and id in (${sql.join(jobIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
            ${workIds ? sql`and work_id in (${sql.join(workIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
            and ((status = 'queued' and run_after <= now())
              or (status = 'running' and locked_at < now() - make_interval(mins => ${JOB_LEASE_MINUTES})))
          order by priority, run_after, id
          for update skip locked
          limit 1)
        returning ${JOB}`,
    );
    if (!job || job.status === "running") return job;
  }
}

/**
 * Finishes a running job, or queues it again when an enqueue asked for a
 * rerun: a rerun is new work, so its attempts start again at zero
 */
export async function finishEnrichmentJob(input: { id: string; worker: string; outcome?: Record<string, unknown> }, conn: Db = appDb) {
  const outcome = input.outcome ? JSON.stringify({ outcome: input.outcome }) : "{}";
  return one(
    conn,
    sql`update enrichment_jobs set
        status = case when rerun then 'queued' else 'done' end,
        finished_at = case when rerun then null else now() end,
        run_after = case when rerun then now() else run_after end,
        attempts = case when rerun then 0 else attempts end,
        rerun = false, locked_at = null, locked_by = null, last_error = null,
        payload = payload || ${outcome}::jsonb, updated_at = now()
      where id = ${input.id}::uuid and status = 'running' and locked_by = ${input.worker}
      returning ${JOB}`,
  );
}

/** A failed attempt: retried after 2^attempts minutes, failed for good after the last */
export async function failEnrichmentJob(input: { id: string; worker: string; error: unknown }, conn: Db = appDb) {
  return one(
    conn,
    sql`update enrichment_jobs set
        status = case when attempts >= ${MAX_JOB_ATTEMPTS} then 'failed' else 'queued' end,
        finished_at = case when attempts >= ${MAX_JOB_ATTEMPTS} then now() end,
        run_after = case when attempts >= ${MAX_JOB_ATTEMPTS} then run_after else now() + make_interval(mins => power(2, attempts)::int) end,
        locked_at = null, locked_by = null, rerun = false, last_error = ${jobError(input.error)}, updated_at = now()
      where id = ${input.id}::uuid and status = 'running' and locked_by = ${input.worker}
      returning ${JOB}`,
  );
}

/**
 * Holds a running job (a quota, a rate limit, a budget, a book's cost
 * ceiling): a hold is not a failure. A pending rerun is dropped: the job runs
 * again from the start when its hold is released.
 */
export async function holdEnrichmentJob(input: { id: string; worker: string; reason: string }, conn: Db = appDb) {
  const reason = heldReasonSchema.parse(input.reason);
  return one(
    conn,
    sql`update enrichment_jobs set status = 'held', held_reason = ${reason}, attempts = greatest(attempts - 1, 0),
        rerun = false, locked_at = null, locked_by = null, updated_at = now()
      where id = ${input.id}::uuid and status = 'running' and locked_by = ${input.worker}
      returning ${JOB}`,
  );
}

/**
 * Releases the holds a stage's next run may retry: quota, rate limit and
 * budget. A book's cost ceiling waits for Pablo: only a run he names the
 * book for (`jobIds`) releases it.
 */
export async function releaseHeldEnrichmentJobs(kind?: EnrichmentJobKind, conn: Db = appDb, options: { jobIds?: string[] } = {}) {
  const k = kind ? jobKindSchema.parse(kind) : null;
  const named = options.jobIds?.length
    ? sql`or (held_reason = 'work_cost_ceiling' and id in (${sql.join(options.jobIds.map((id) => sql`${id}::uuid`), sql`, `)}))`
    : sql``;
  const released = resultRows<{ id: string }>(
    await conn.execute(sql`update enrichment_jobs set status = 'queued', held_reason = null, updated_at = now()
      where status = 'held' and (held_reason in ('quota', 'rate_limited', 'budget') ${named}) ${k ? sql`and kind = ${k}` : sql``}
      returning id`),
  );
  return released.length;
}
