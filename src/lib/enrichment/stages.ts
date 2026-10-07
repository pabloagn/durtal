import type { Db } from "@/lib/catalogue/work-store";
import type { EnrichmentJobKind } from "./model";
import type { SourceCache } from "./source-cache";
import { identityStage } from "./identity-stage";
import { researchStage } from "./research/stage";
import { extractStage } from "./research/extract-stage";

/*
 * The enrichment stages the worker runs (SLN-464), one per job kind. A stage
 * fetches source answers for its jobs into the cache, plans one job from the
 * cache, and writes that plan in the job's transaction. Its steps run before
 * the jobs of an apply, each in its own transaction (a review file, a sweep,
 * a re-queue). Its undo removes what it wrote in a run besides the applies.
 * A stage whose job calls paid or slow services outside any transaction
 * (research searches and fetches, SLN-469) does that in `work`, between the
 * claim and the write. SLN-464 registers `identity`; later stages register theirs.
 */

export interface StageJob {
  id: string;
  workId: string;
  slug: string | null;
  title: string;
  kind: EnrichmentJobKind;
  status: string;
  heldReason: string | null;
  priority: number;
  payload: Record<string, unknown>;
}

export interface StageContext {
  /** The run's id: every claim's `run_id` and every apply's `batch_id` */
  runId: string;
  cache: SourceCache;
  /** Milliseconds between two calls to one source */
  pace: number;
  /** The contact of the User-Agent; a stage that calls out refuses without it */
  contact: string | null;
  /** An apply run; a plan makes no paid call, no fetch and no write */
  apply: boolean;
}

export interface StageStep {
  /** As the report names it, for example "Review file" */
  name: string;
  /** What the step would do, read only */
  plan(conn: Db, ctx: StageContext): Promise<string[]>;
  /** Runs the step in its own transaction */
  apply(tx: Db, ctx: StageContext): Promise<string[]>;
}

export interface EnrichmentStage<Plan = unknown> {
  kind: EnrichmentJobKind;
  /** It calls outside services, so it needs ENRICHMENT_CONTACT */
  callsOut: boolean;
  /** Fetches the jobs' answers into the cache, outside any transaction; throws QuotaStop on a refusal */
  fetch(conn: Db, jobs: StageJob[], ctx: StageContext): Promise<void>;
  /** Plans one job from the cache, with a line for the report */
  plan(conn: Db, job: StageJob, ctx: StageContext): Promise<{ plan: Plan; summary: string }>;
  /** Refuses an apply run that cannot work, before anything runs (a missing key, an extractor not installed) */
  preflight?(ctx: StageContext): void;
  /**
   * Apply only: one claimed job's calls, outside any transaction, on the
   * run's connection; returns the plan the write gets. A QuotaStop,
   * BudgetStop or WorkCeilingStop holds the job without an attempt.
   */
  work?(conn: Db, job: StageJob, plan: Plan, ctx: StageContext): Promise<Plan>;
  /** Writes one job's plan in its transaction and returns the job's outcome */
  write(tx: Db, job: StageJob, plan: Plan, ctx: StageContext): Promise<Record<string, unknown>>;
  steps: StageStep[];
  /** Removes what the stage wrote in a run besides its applies, which the worker undoes first */
  undo(tx: Db, runId: string): Promise<string[]>;
  /** Lines on the run's plans as a whole (for example what each source found) */
  summarize?(plans: Plan[]): string[];
  /** Lines on the run's written jobs as a whole (for example the counts of an apply) */
  outcomes?(outcomes: Record<string, unknown>[]): string[];
  /** Lines the report ends with, read from the database (for example the unresolved books) */
  epilogue?(conn: Db): Promise<string[]>;
}

export const ENRICHMENT_STAGES: Partial<Record<EnrichmentJobKind, EnrichmentStage>> = {
  identity: identityStage() as EnrichmentStage,
  research: researchStage() as EnrichmentStage,
  extract: extractStage() as EnrichmentStage,
};

/** The stages of the kinds a run names; a kind without a stage is refused */
export function stagesFor(kinds: EnrichmentJobKind[], stages: Partial<Record<EnrichmentJobKind, EnrichmentStage>> = ENRICHMENT_STAGES) {
  return kinds.map((kind) => {
    const stage = stages[kind];
    if (!stage) throw new Error(`No enrichment stage works ${kind} jobs yet`);
    return stage;
  });
}
