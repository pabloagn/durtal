import { and, count, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { ebookFiles, ebookIngestItems, ebookIngestRuns, ebooks } from "@/lib/db/schema";
import type { IngestReconciliation } from "@/lib/db/schema/ebook-ingest";
import { resultRows } from "@/lib/harmonization/store";

/*
 * The two pages of ingestion runs (SLN-494), read only: /ebooks/runs lists
 * the runs, /ebooks/runs/[runId] one run's files by outcome. No path is ever
 * read from disk: a run made on another machine is only described.
 */

/** Rows shown at first, and added by each "Show 50 more" */
export const RUN_ROWS_STEP = 50;
const MAX_ROWS = 5_000;

/** How many rows a "Show 50 more" URL asks for: 50 unless it asks for more, up to 5,000 */
export function shownRows(value: string | string[] | undefined): number {
  const asked = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(asked) && asked > RUN_ROWS_STEP ? Math.min(asked, MAX_ROWS) : RUN_ROWS_STEP;
}

export interface RunSummary {
  id: string;
  kind: string;
  state: string;
  host: string | null;
  roots: string[];
  counts: Record<string, number>;
  /** An upload run's batch, which its upload page opens; null for other runs */
  uploadBatchId: string | null;
  reconciliation: IngestReconciliation | null;
  startedAt: Date;
  finishedAt: Date | null;
  updatedAt: Date;
}

const RUN_COLUMNS = {
  id: ebookIngestRuns.id,
  kind: ebookIngestRuns.kind,
  state: ebookIngestRuns.state,
  host: ebookIngestRuns.host,
  roots: ebookIngestRuns.roots,
  counts: ebookIngestRuns.counts,
  reconciliation: ebookIngestRuns.reconciliation,
  startedAt: ebookIngestRuns.startedAt,
  finishedAt: ebookIngestRuns.finishedAt,
  updatedAt: ebookIngestRuns.updatedAt,
};

type StoredRun = Omit<RunSummary, "uploadBatchId">;

/**
 * An upload run keeps no counts of its own (its batch is checked against an
 * empty `counts`), so its files are counted where they are: added once a
 * confirmation committed, as its run settles, else by their state (SLN-1467).
 */
async function withUploadCounts(runs: StoredRun[]): Promise<RunSummary[]> {
  const uploads = runs.filter((run) => run.kind === "upload").map((run) => run.id);
  const facts = new Map<string, { counts: Record<string, number>; batchId: string | null }>();
  if (uploads.length) {
    const rows = resultRows<{ runId: string; batchId: string | null; added: number; canceled: number; expired: number; failed: number; pending: number }>(
      await db.execute(sql`
        select b.run_id as "runId", b.id as "batchId",
          count(u.id) filter (where u.added)::int as added,
          count(u.id) filter (where not u.added and u.state = 'canceled')::int as canceled,
          count(u.id) filter (where not u.added and u.state = 'expired')::int as expired,
          count(u.id) filter (where not u.added and u.state = 'failed')::int as failed,
          count(u.id) filter (where not u.added and u.state not in ('canceled', 'expired', 'failed'))::int as pending
        from ebook_upload_operations b
        left join lateral (
          select o.id, o.state, exists(select 1 from ebook_upload_operations e where e.parent_operation_id = o.id
            and e.input->>'action' = 'confirm' and e.state = 'completed' and e.receipt_status = 200
            and e.effect_committed_at is not null) as added
          from ebook_upload_operations o where o.run_id = b.run_id and o.kind = 'upload'
        ) u on true
        where b.kind = 'batch' and b.run_id in (${sql.join(uploads.map((id) => sql`${id}::uuid`), sql`, `)})
        group by b.run_id, b.id`),
    );
    for (const { runId, batchId, ...counts } of rows) facts.set(runId, { counts, batchId });
  }
  return runs.map((run) => {
    const upload = facts.get(run.id);
    return { ...run, counts: upload?.counts ?? run.counts, uploadBatchId: upload?.batchId ?? null };
  });
}

/** The newest runs first, `limit` of them, and how many there are */
export async function listRuns(limit: number): Promise<{ runs: RunSummary[]; total: number }> {
  const [runs, [{ total }]] = await Promise.all([
    db.select(RUN_COLUMNS).from(ebookIngestRuns).orderBy(desc(ebookIngestRuns.startedAt), desc(ebookIngestRuns.id)).limit(limit),
    db.select({ total: count() }).from(ebookIngestRuns),
  ]);
  return { runs: await withUploadCounts(runs), total };
}

export async function getRun(id: string): Promise<RunSummary | null> {
  const [run] = await db.select(RUN_COLUMNS).from(ebookIngestRuns).where(eq(ebookIngestRuns.id, id));
  return run ? (await withUploadCounts([run]))[0] : null;
}

const item = ebookIngestItems;
const notFailed = ne(item.state, "failed");
const outcome = (value: (typeof item.outcome.enumValues)[number]) => and(eq(item.outcome, value), notFailed)!;

/** The run page's sections, in its order: what needs a look first */
export const RUN_SECTIONS = [
  { key: "failed", title: "Failed", where: eq(item.state, "failed") },
  { key: "quarantined", title: "Quarantined", where: outcome("quarantined") },
  { key: "drm", title: "DRM", where: isNotNull(ebookFiles.drm) },
  { key: "changed", title: "Changed since the plan", where: outcome("changed_since_plan") },
  { key: "ignored", title: "Ignored", where: outcome("ignored") },
  { key: "duplicates", title: "Duplicates", where: outcome("duplicate_in_run") },
  { key: "new", title: "New eBooks", where: outcome("new_ebook") },
  { key: "formats", title: "Formats added", where: outcome("new_format") },
  { key: "replaced", title: "Changed files", where: outcome("replaced_file") },
  { key: "stored", title: "Already stored", where: outcome("already_stored") },
  { key: "waiting", title: "Not done yet", where: inArray(item.state, ["pending", "stored", "registered"]) },
] as const satisfies readonly { key: string; title: string; where: SQL }[];
export type RunSectionKey = (typeof RUN_SECTIONS)[number]["key"];

export interface RunItem {
  id: string;
  path: string;
  format: string | null;
  sizeBytes: number;
  state: string;
  outcome: string | null;
  reason: string | null;
  lastError: string | null;
  drm: string | null;
  ebookId: string | null;
  ebookTitle: string | null;
}

export interface RunSection {
  key: RunSectionKey;
  title: string;
  total: number;
  items: RunItem[];
}

/** Every section of a run with items: its count, and its first `shown[key]` rows (50 unless the URL asks for more) */
export async function runSections(runId: string, shown: Partial<Record<RunSectionKey, number>>): Promise<RunSection[]> {
  const inRun = eq(item.runId, runId);
  const [totals] = await db
    .select(Object.fromEntries(RUN_SECTIONS.map((s) => [s.key, sql<number>`(count(*) filter (where ${s.where}))::int`])) as Record<RunSectionKey, SQL<number>>)
    .from(item)
    .leftJoin(ebookFiles, eq(ebookFiles.id, item.fileId))
    .where(inRun);
  const present = RUN_SECTIONS.filter((s) => (totals?.[s.key] ?? 0) > 0);
  return Promise.all(
    present.map(async (section) => ({
      key: section.key,
      title: section.title,
      total: totals[section.key],
      items: await db
        .select({
          id: item.id,
          path: item.sourcePath,
          format: item.format,
          sizeBytes: item.sizeBytes,
          state: item.state,
          outcome: item.outcome,
          reason: item.reason,
          lastError: item.lastError,
          drm: ebookFiles.drm,
          ebookId: item.ebookId,
          ebookTitle: ebooks.title,
        })
        .from(item)
        .leftJoin(ebookFiles, eq(ebookFiles.id, item.fileId))
        .leftJoin(ebooks, eq(ebooks.id, item.ebookId))
        .where(and(inRun, section.where))
        .orderBy(item.sourcePath)
        .limit(shown[section.key] ?? RUN_ROWS_STEP),
    })),
  );
}
