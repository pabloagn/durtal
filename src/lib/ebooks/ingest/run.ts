import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { ebookFiles, ebookIngestItems, ebookIngestRuns } from "@/lib/db/schema";
import type { IngestOutcome, IngestReconciliation } from "@/lib/db/schema/ebook-ingest";
import { recentBackup } from "@/lib/enrichment/backup";
import { appendUndoLog, reserveUndoLog } from "@/lib/books/undo-file";
import { storable, storableText } from "./metadata";
import { derivedCachePath } from "./prepare";
import { INGEST_TOOL_VERSION, type IngestPlan, type PlanGroup, type PlanTarget } from "./plan";
import { readGroupCatalogue, planRegistration, registerGroup, undoEntry } from "./register";
import { reconcileIngest } from "./reconcile";
import { storeObject } from "./store";
import { objectMatches } from "../storage";
import { isLegacyFileKey } from "../keys";
import { medallionOf } from "../medallion";
import { validateStagePlan, verifyPublication } from "../publication";

export { planIngest } from "./plan";

/*
 * Applying a plan (SLN-494): exactly the objects and rows it names. Each
 * file is re-checked (changed since the plan: skipped and listed), stored
 * and verified with its covers and manifest, then its group is registered
 * in one atomic. A crash or Ctrl-C leaves the run `interrupted`; a resume
 * carries on with every item that is not done, adopting objects already in
 * S3 and never registering a file twice. The run ends with a
 * reconciliation: `finished` when it is exact, else `failed`.
 */

/** A plan older than this is planned again */
export const PLAN_MAX_AGE_DAYS = 7;
/** Groups stored and registered at once (each uploads its files one after another; groups of one e-book wait for each other) */
const GROUPS_AT_ONCE = 6;
/** The run's counts are written after every so many items */
const COUNTS_EVERY = 50;
/** Attempts after which an item stays failed and is listed */
export const MAX_ATTEMPTS = 5;

export interface ApplyOptions {
  database: Db;
  host: string;
  cacheDir: string;
  /** The current target: the plan must have been made against it */
  target: PlanTarget;
  /** A pg_dump custom-format backup written in the last hour */
  backup?: string;
  /** The database is not a local preview: allowed only with --live */
  live: boolean;
  localDatabase: boolean;
  /** Where the undo file goes */
  reportDir: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Stops taking new groups (Ctrl-C); the run becomes interrupted */
  signal?: AbortSignal;
  /** Tests: a failure between storing and registering */
  afterStore?: (filePath: string) => void | Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

export interface ApplyResult {
  runId: string;
  state: "finished" | "interrupted" | "failed";
  counts: Record<string, number>;
  undoFile: string;
  exact: boolean | null;
  reconciliation: IngestReconciliation | null;
  uploadedBytes: number;
  seconds: number;
}

/** The most a failed item's reason and last error hold */
const FAILURE_MESSAGE_MAX = 500;

/**
 * What a failed item records: the error's own words, never the ORM's "Failed
 * query" with every parameter (a 20,000-character description, or the very
 * character PostgreSQL refused), made storable and short, so recording a
 * failure cannot fail.
 */
export function failureMessage(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error && current.message.startsWith("Failed query:") && current.cause; depth++) current = current.cause;
  const text =
    storableText(current instanceof Error ? current.message : String(current))
      .replace(/\s+/g, " ")
      .trim() || "Unknown error";
  return text.length > FAILURE_MESSAGE_MAX ? `${text.slice(0, FAILURE_MESSAGE_MAX - 1)}…` : text;
}

/**
 * A plan file as the apply reads it: every string storable, so a plan made
 * before file metadata was cleaned, or kept for a resume, writes its rows too.
 */
const readPlan = (text: string) => storable(JSON.parse(text) as IngestPlan);

/** The SHA-256 of a plan file's bytes: what the run row records */
export function planSha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The version and target checks an apply and a resume share; throws the first that fails */
function checkPlanTarget(plan: IngestPlan, target: PlanTarget) {
  if (plan.v !== 1 || plan.toolVersion !== INGEST_TOOL_VERSION) throw new Error("The plan was made by another version of the tool: plan again. Nothing written.");
  if (plan.target.database !== target.database) throw new Error("The plan was made against another database. Nothing written.");
  if (
    plan.target.bucket !== target.bucket ||
    plan.target.prefix !== target.prefix ||
    plan.target.preview !== target.preview ||
    plan.target.region !== target.region ||
    plan.target.credentialIdentity !== target.credentialIdentity ||
    plan.target.previewRoot !== target.previewRoot
  )
    throw new Error("The plan was made against another bucket. Nothing written.");
}

/** Every check an apply makes before writing anything; throws the first that fails */
export function checkApply(plan: IngestPlan, options: Pick<ApplyOptions, "target" | "backup" | "live" | "localDatabase"> & { now?: number }) {
  const now = options.now ?? Date.now();
  checkPlanTarget(plan, options.target);
  if (now - Date.parse(plan.createdAt) > PLAN_MAX_AGE_DAYS * 86_400_000) throw new Error(`The plan is older than ${PLAN_MAX_AGE_DAYS} days: plan again. Nothing written.`);
  if (!recentBackup(options.backup, now)) throw new Error("--apply needs --backup FILE: a pg_dump custom-format backup taken in the last hour. Nothing written.");
  if (!options.localDatabase && !options.live) throw new Error("This database is not a local preview: an apply to it needs --live. Nothing written.");
}

/** Where an applied plan is kept, so a resume reads exactly what the run executed */
const keptPlan = (cacheDir: string, sha256: string) => path.join(cacheDir, "plans", `${sha256}.json`);

/** Applies a plan: creates the run and its items, then stores and registers every group */
export async function applyPlan(planFile: string, options: ApplyOptions): Promise<ApplyResult> {
  const text = readFileSync(planFile, "utf8");
  const plan = readPlan(text);
  const now = options.now ?? Date.now;
  checkApply(plan, { ...options, now: now() });
  for (const file of Object.values(plan.files)) validateStagePlan(file);
  const sha = planSha256(text);
  mkdirSync(path.dirname(keptPlan(options.cacheDir, sha)), { recursive: true });
  copyFileSync(planFile, keptPlan(options.cacheDir, sha));

  const at = new Date(now());
  const [run] = await options.database
    .insert(ebookIngestRuns)
    .values({ kind: "apply", host: plan.host, roots: plan.roots, planSha256: sha, toolVersion: INGEST_TOOL_VERSION, startedAt: at, updatedAt: at })
    .returning({ id: ebookIngestRuns.id });
  mkdirSync(options.reportDir, { recursive: true });
  const undoFile = path.join(options.reportDir, `ingest-undo-${run.id}.jsonl`);
  reserveUndoLog(undoFile, { runId: run.id, planSha256: sha, createdAt: at.toISOString() });

  // Every path the plan saw, as an item; ignored files and duplicates have nothing left to do
  const rows = plan.items.map((item) => {
    const settled = item.outcome === "ignored" || item.outcome === "duplicate_in_run";
    return {
      runId: run.id,
      sourceHost: plan.host,
      sourcePath: item.path,
      sizeBytes: item.size,
      sourceMtime: new Date(item.mtimeMs),
      sha256: item.sha256,
      format: item.format,
      state: settled ? ("done" as const) : ("pending" as const),
      outcome: settled ? item.outcome : null,
      reason: settled ? item.reason : null,
      createdAt: at,
      updatedAt: at,
    };
  });
  for (let i = 0; i < rows.length; i += 500) await options.database.insert(ebookIngestItems).values(rows.slice(i, i + 500));
  return processRun(run.id, plan, undoFile, options);
}

/** Carries on with a run's items that are not done, from the plan it executed */
export async function resumeRun(runId: string, options: ApplyOptions): Promise<ApplyResult> {
  const [run] = await options.database.select().from(ebookIngestRuns).where(eq(ebookIngestRuns.id, runId));
  if (!run) throw new Error(`No run ${runId}. Nothing written.`);
  if (run.kind !== "apply" || !run.planSha256) throw new Error("Only an apply can be resumed. Nothing written.");
  if (run.state === "finished") throw new Error("The run finished: there is nothing to resume.");
  const file = keptPlan(options.cacheDir, run.planSha256);
  if (!existsSync(file)) throw new Error(`The run's plan is not in ${path.dirname(file)}: resume on the machine that applied it. Nothing written.`);
  const plan = readPlan(readFileSync(file, "utf8"));
  if (!recentBackup(options.backup, options.now?.() ?? Date.now()))
    throw new Error("--resume needs --backup FILE: a pg_dump custom-format backup taken in the last hour. Nothing written.");
  if (!options.localDatabase && !options.live) throw new Error("This database is not a local preview: a resume of it needs --live. Nothing written.");
  // A run made by another version of the tool is not resumed: a new plan adopts what it stored
  checkPlanTarget(plan, options.target);
  for (const file of Object.values(plan.files)) validateStagePlan(file);
  if (planSha256(readFileSync(file, "utf8")) !== run.planSha256) throw new Error("The saved plan changed. Nothing written.");
  const undoFile = path.join(options.reportDir, `ingest-undo-${run.id}.jsonl`);
  if (!existsSync(undoFile))
    reserveUndoLog(undoFile, {
      runId: run.id,
      planSha256: run.planSha256,
      createdAt: new Date().toISOString(),
    });
  await options.database.update(ebookIngestRuns).set({ state: "running", updatedAt: new Date() }).where(eq(ebookIngestRuns.id, run.id));
  return processRun(run.id, plan, undoFile, options);
}

async function processRun(runId: string, plan: IngestPlan, undoFile: string, options: ApplyOptions): Promise<ApplyResult> {
  const db = options.database;
  const now = options.now ?? Date.now;
  const started = now();
  const open = await db
    .select({
      path: ebookIngestItems.sourcePath,
      fileId: ebookIngestItems.fileId,
      state: ebookIngestItems.state,
      attempts: ebookIngestItems.attempts,
    })
    .from(ebookIngestItems)
    .where(and(eq(ebookIngestItems.runId, runId), ne(ebookIngestItems.state, "done"), lt(ebookIngestItems.attempts, MAX_ATTEMPTS)));
  const openPaths = new Set(open.map((o) => o.path));
  const registered = new Map(open.filter((o) => o.state === "registered").map((o) => [o.path, o.fileId]));
  const registeredPaths = new Set(registered.keys());
  const work = plan.groups.filter((group) => group.paths.some((p) => openPaths.has(p)));
  const clusters = clusterGroups(work);

  let counts = await currentCounts(db, runId);
  let sinceWrite = 0;
  let processed = 0;
  let uploadedBytes = 0;
  const writeCounts = async (force = false) => {
    if (!force && sinceWrite < COUNTS_EVERY) return;
    sinceWrite = 0;
    // Replaced, not merged: an outcome no item has any more (pending, at the end) must go
    counts = await currentCounts(db, runId);
    await db
      .update(ebookIngestRuns)
      .set({ counts, updatedAt: new Date(now()) })
      .where(eq(ebookIngestRuns.id, runId));
  };
  const setItems = (paths: string[], values: Partial<typeof ebookIngestItems.$inferInsert>) =>
    paths.length
      ? db
          .update(ebookIngestItems)
          .set({ ...values, updatedAt: new Date(now()) })
          .where(and(eq(ebookIngestItems.runId, runId), inArray(ebookIngestItems.sourcePath, paths)))
      : Promise.resolve();

  let crashed: unknown = null;
  const processGroup = async (group: PlanGroup) => {
    const paths = group.paths.filter((p) => openPaths.has(p));
    let simulated = false;
    try {
      // A committed duplicate names the catalogue publication, not fresh plan artifacts.
      const alreadyRegistered = paths.filter((p) => registeredPaths.has(p));
      for (const p of alreadyRegistered) {
        const fileId = registered.get(p);
        const [stored] = fileId ? await db.select().from(ebookFiles).where(eq(ebookFiles.id, fileId)).limit(1) : [];
        if (!stored || stored.sha256 !== plan.files[p].sha256) throw new Error("The registered file is missing or differs from the plan");
        const stages = medallionOf(stored.metadata);
        const expectedKey = stages ? (stages.validation.downloadable ? stages.gold[0]?.key : stages.bronze.key) : null;
        if (
          (stages ? stored.s3Key !== expectedKey : !isLegacyFileKey(stored.s3Key, stored.sha256, stored.format)) ||
          !(await objectMatches(stored.s3Key, stored.sizeBytes, stored.sha256))
        )
          throw new Error("The registered object's bytes or key differ");
        const problem = await verifyPublication(stored.metadata);
        if (problem) throw new Error(problem);
      }
      await setItems(alreadyRegistered, { state: "done", lastError: null });
      const toRegister = paths.filter((p) => !registeredPaths.has(p));
      if (toRegister.length === 0) return;
      // Changed since the plan: skipped and listed
      const unchanged: string[] = [];
      for (const p of toRegister) {
        const file = plan.files[p];
        const info = await stat(p).catch(() => null);
        if (!info || info.size !== file.size || Math.abs(info.mtimeMs - file.mtimeMs) > 1) {
          await setItems([p], {
            state: "done",
            outcome: "changed_since_plan",
            reason: info ? "Changed since the plan" : "Gone since the plan",
          });
        } else unchanged.push(p);
      }
      if (unchanged.length === 0) return;
      const files = unchanged.map((p) => plan.files[p]);

      // Store the files and their derived objects; already stored ones need nothing
      const catalogue = await readGroupCatalogue(db, group, files);
      for (const file of files) {
        if (catalogue.bySha.has(file.sha256)) {
          const stored = catalogue.bySha.get(file.sha256)!;
          if (stored.metadata && medallionOf(stored.metadata)) {
            const problem = await verifyPublication(stored.metadata);
            if (problem) throw new Error(problem);
          }
          continue;
        }
        const stages = file.medallion;
        if (!stages) throw new Error("The plan has no medallion validation: plan again");
        const store = async (
          object: {
            key: string;
            sha256: string;
            size: number;
            contentType: string;
          },
          source: string,
        ) => {
          if (!existsSync(source)) throw new Error("The plan's artifact is no longer cached: plan again");
          const result = await storeObject(
            {
              ...object,
              filename: object.key === file.key ? file.downloadName : undefined,
              body: { file: source },
            },
            { cacheDir: options.cacheDir, sleep: options.sleep },
          );
          if (!result.adopted) uploadedBytes += object.size;
        };
        await store(stages.bronze, file.path);
        await store(stages.silver, path.join(options.cacheDir, "silver", `${stages.silver.sha256}.json`));
        if (stages.validation.downloadable) {
          await store(stages.gold[0], file.path);
          // Covers before the publication marker, which is always last.
          for (const object of file.derived) {
            const cached =
              object.name === "manifest.json"
                ? path.join(options.cacheDir, "publications", stages.silver.sha256, "manifest.json")
                : derivedCachePath(options.cacheDir, file.sha256, object.name);
            await store(object, cached);
          }
        }
        const publication = await verifyPublication(file.metadata);
        if (publication) throw new Error(publication);
        await setItems([file.path], { state: "stored" });
        if (options.afterStore) {
          simulated = true;
          await options.afterStore(file.path);
          simulated = false;
        }
      }

      // Rows: the undo line first, then one atomic for the group and its items
      const registration = planRegistration(group, files, catalogue, {
        host: plan.host,
        at: new Date(now()),
      });
      appendUndoLog(undoFile, undoEntry(registration));
      await registerGroup(db, registration, runId);
      await setItems(unchanged, { state: "done" });
    } catch (error) {
      // A crash the tests stage between storing and registering: nothing more is written, as after a kill
      if (simulated) {
        crashed ??= error;
        return;
      }
      const message = failureMessage(error);
      await db
        .update(ebookIngestItems)
        .set({
          state: "failed",
          lastError: message,
          reason: message,
          attempts: sql`${ebookIngestItems.attempts} + 1`,
          updatedAt: new Date(now()),
        })
        .where(and(eq(ebookIngestItems.runId, runId), inArray(ebookIngestItems.sourcePath, paths), ne(ebookIngestItems.state, "done")));
    } finally {
      processed += paths.length;
      sinceWrite += paths.length;
      options.onProgress?.(processed, openPaths.size);
      await writeCounts();
    }
  };

  // Groups of one e-book go one after another in one lane, so each sees the rows the one before wrote
  let next = 0;
  const lanes = Array.from({ length: Math.min(GROUPS_AT_ONCE, clusters.length) }, async () => {
    while (next < clusters.length && !options.signal?.aborted && !crashed) {
      for (const group of clusters[next++]) {
        if (crashed) break;
        await processGroup(group);
      }
    }
  });

  // A lane that cannot even record a failure (the database is gone) stops the run; the others finish their group first
  for (const lane of await Promise.allSettled(lanes)) if (lane.status === "rejected") crashed ??= lane.reason;
  // Duplicates point at the file their first path stored
  await db.execute(sql`update ebook_ingest_items d set ebook_id = f.ebook_id, file_id = f.file_id
    from ebook_ingest_items f
    where d.run_id = ${runId} and f.run_id = ${runId} and d.outcome = 'duplicate_in_run' and d.sha256 = f.sha256
      and f.file_id is not null and d.file_id is null`);
  await writeCounts(true);
  const seconds = Math.max(0.001, (now() - started) / 1000);
  if (uploadedBytes > 0) saveUploadSpeed(options.cacheDir, uploadedBytes / seconds);

  if (crashed || options.signal?.aborted) {
    await db
      .update(ebookIngestRuns)
      .set({ state: "interrupted", updatedAt: new Date(now()) })
      .where(eq(ebookIngestRuns.id, runId));
    if (crashed) throw crashed;
    return {
      runId,
      state: "interrupted",
      counts,
      undoFile,
      exact: null,
      reconciliation: null,
      uploadedBytes,
      seconds,
    };
  }

  const reconciliation = await reconcileIngest({
    database: db,
    roots: plan.roots,
    host: plan.host,
    cacheDir: options.cacheDir,
    includeText: plan.includeText,
    exclude: plan.exclude,
    // A trial's plan took only its first files: the others are not this run's to account for
    paths: plan.limit ? plan.items.map((i) => i.path) : undefined,
    runId,
    now: now(),
  });
  const state = reconciliation.exact ? "finished" : "failed";
  await db
    .update(ebookIngestRuns)
    .set({
      state,
      reconciliation,
      finishedAt: new Date(now()),
      updatedAt: new Date(now()),
    })
    .where(eq(ebookIngestRuns.id, runId));
  return {
    runId,
    state,
    counts,
    undoFile,
    exact: reconciliation.exact,
    reconciliation,
    uploadedBytes,
    seconds,
  };
}

/**
 * The plan's groups in sets that join one e-book: the same sidecar uuid (two
 * folders of one book) or the same catalogued e-book. A set is processed in
 * order, so a later group adds to the e-book the earlier one created.
 */
export function clusterGroups(groups: PlanGroup[]): PlanGroup[][] {
  const owner = new Map<string, number>();
  const clusters: PlanGroup[][] = [];
  for (const group of groups) {
    const keys = [group.importRef ? `ref:${group.importRef}` : null, group.existingEbookId ? `ebook:${group.existingEbookId}` : null].filter((k): k is string => !!k);
    const found = [...new Set(keys.map((k) => owner.get(k)).filter((i): i is number => i !== undefined))].sort((a, b) => a - b);
    const at = found.length ? found[0] : clusters.push([]) - 1;
    for (const other of found.slice(1)) {
      clusters[at].push(...clusters[other]);
      clusters[other] = [];
      for (const [key, index] of owner) if (index === other) owner.set(key, at);
    }
    clusters[at].push(group);
    for (const key of keys) owner.set(key, at);
  }
  return clusters.filter((c) => c.length > 0);
}

/** One count per item outcome, plus failed and pending items */
async function currentCounts(db: Db, runId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({
      outcome: ebookIngestItems.outcome,
      state: ebookIngestItems.state,
      n: sql<number>`count(*)::int`,
    })
    .from(ebookIngestItems)
    .where(eq(ebookIngestItems.runId, runId))
    .groupBy(ebookIngestItems.outcome, ebookIngestItems.state);
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key: IngestOutcome | "failed" | "pending" = row.state === "failed" ? "failed" : row.state === "done" && row.outcome ? row.outcome : "pending";
    counts[key] = (counts[key] ?? 0) + row.n;
  }
  return counts;
}

const speedFile = (cacheDir: string) => path.join(cacheDir, "upload-speed.json");

/** Bytes a second the last apply on this machine uploaded at: the plan's estimate */
export function readUploadSpeed(cacheDir: string): number | null {
  try {
    const { bytesPerSecond } = JSON.parse(readFileSync(speedFile(cacheDir), "utf8")) as { bytesPerSecond: number };
    return Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? bytesPerSecond : null;
  } catch {
    return null;
  }
}

function saveUploadSpeed(cacheDir: string, bytesPerSecond: number) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(speedFile(cacheDir), JSON.stringify({ bytesPerSecond, at: new Date().toISOString() }));
}
