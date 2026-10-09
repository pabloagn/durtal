import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { ebooks, ebookMatchCandidates } from "@/lib/db/schema";
import { atomicOn } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { assertSql } from "@/lib/harmonization/store";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { databaseFingerprint } from "../ingest/command";
import { indexCatalogue } from "./catalogue";
import { classificationQueries } from "./classification";
import {
  loadMatchDependencies,
  referencingRows,
  dependencyGuardCondition,
  type DependencySnapshot,
} from "./dependencies";
import { snapshotGuardQueries } from "./guards";
import {
  dataFingerprint,
  loadMatchCatalogue,
  type LoadedMatchCatalogue,
  type StoredRow,
} from "./load";
import type { LinkReceipt } from "./link";
import { MATCH_MODEL } from "./model";
import { hashMatchingPlan } from "./plan";
import { matchOne } from "./tiers";
import type { MatchOperationIdentity, MatchResult } from "./types";

const same = (a: unknown, b: unknown) =>
  dataFingerprint(a) === dataFingerprint(b);
const identityMatches = (
  a: MatchOperationIdentity,
  b: MatchOperationIdentity,
) =>
  a.version === 1 &&
  b.version === 1 &&
  a.operationId === b.operationId &&
  a.runId === b.runId &&
  a.planSha256 === b.planSha256 &&
  a.targetDatabase === b.targetDatabase;
export interface UndoCleanup {
  deleted: Readonly<
    Record<
      "instances" | "editions" | "works" | "authors" | "series",
      readonly string[]
    >
  >;
  activityIds: readonly string[];
  jobIds: readonly string[];
  restoreCopy: { id: string; editionId: string; updatedAt: unknown } | null;
  retained: readonly { table: string; id: string; reason: string }[];
}
/** Every dependent row must be an unchanged operation-owned row that the
 * same undo removes. Unknown future FK tables are therefore preservation
 * evidence, not an invitation to cascade through owner records. */
export function decideUndoCleanup(
  receipt: LinkReceipt,
  loaded: LoadedMatchCatalogue,
  dependencies: DependencySnapshot,
): UndoCleanup {
  if (!receipt.after)
    throw new Error("Committed matching receipt has no after snapshots");
  const after = receipt.after;
  if (
    after.instance.id !== receipt.instanceId ||
    after.instance.edition_id !== receipt.editionId ||
    after.edition.id !== receipt.editionId ||
    after.edition.work_id !== receipt.workId ||
    after.work.id !== receipt.workId ||
    after.ebook.id !== receipt.ebookId ||
    after.authors.some(
      (row) => !receipt.authorIdsCreated.includes(String(row.id)),
    ) ||
    (after.series && after.series.id !== receipt.seriesIdCreated)
  )
    throw new Error("Committed receipt parent identities are inconsistent");
  const deleted: Record<
    "instances" | "editions" | "works" | "authors" | "series",
    string[]
  > = { instances: [], editions: [], works: [], authors: [], series: [] };
  const retained: { table: string; id: string; reason: string }[] = [];
  const removed = new Set<string>();
  const rows = (table: string) =>
    dependencies.rows[table] ??
    loaded.rows[table as keyof typeof loaded.rows] ??
    [];
  let restoreCopy: UndoCleanup["restoreCopy"] = null;
  if (receipt.movedFromEditionId && receipt.before.instance) {
    const current = loaded.rows.instances.find(
      (row) => row.id === receipt.instanceId,
    );
    const originalEdition = loaded.rows.editions.find(
      (row) => row.id === receipt.movedFromEditionId,
    );
    if (
      current &&
      same(current, after.instance) &&
      originalEdition?.work_id === receipt.workId &&
      originalEdition.metadata_locked !== true
    )
      restoreCopy = {
        id: receipt.instanceId,
        editionId: receipt.movedFromEditionId,
        updatedAt: receipt.before.instance.updated_at,
      };
    else
      retained.push({
        table: "instances",
        id: receipt.instanceId,
        reason: "moved copy or original edition changed",
      });
  }
  const owned = (parent: string, table: string, row: StoredRow) => {
    if (table === "enrichment_jobs" && parent === "works")
      return (
        row.status === "queued" &&
        row.attempts === 0 &&
        (row.payload as Record<string, unknown> | null)?.matchingOperationId ===
          receipt.operationId &&
        (after.ownedChildren?.[table] ?? []).some((saved) =>
          same(saved, row),
        ) &&
        referencingRows(dependencies, table, row).length === 0
      );
    if (
      table === "work_authors" &&
      (parent === "works" ||
        (parent === "authors" && deleted.works.includes(String(row.work_id))))
    )
      return (after.ownedChildren?.[table] ?? []).some((saved) =>
        same(saved, row),
      );
    if (table === "person_domains" && parent === "authors")
      return (after.ownedChildren?.[table] ?? []).some((saved) =>
        same(saved, row),
      );
    return (
      ((table === "instance_status_history" && parent === "instances") ||
        (table === "work_status_history" && parent === "works")) &&
      after.histories.some((saved) => same(saved, row))
    );
  };
  const canDelete = (
    table: keyof typeof deleted,
    snapshot: StoredRow | null,
    requested: boolean,
  ) => {
    if (!requested || !snapshot) return;
    const id = String(snapshot.id);
    const current = rows(table).find((row) => row.id === id);
    if (!current) return;
    const refs = referencingRows(dependencies, table, current);
    const unsafe = refs.some(({ table: child, row }) => {
      if (
        child === "ebooks" &&
        row.id === receipt.ebookId &&
        row.instance_id === receipt.instanceId
      )
        return false;
      if (row.id != null && removed.has(`${child}:${row.id}`)) return false;
      if (
        table === "editions" &&
        child === "instances" &&
        row.id === restoreCopy?.id &&
        row.edition_id === receipt.editionId
      )
        return false;
      return !owned(table, child, row);
    });
    if (!same(current, snapshot) || unsafe) {
      retained.push({
        table,
        id,
        reason: !same(current, snapshot) ? "edited" : "referenced",
      });
      return;
    }
    deleted[table].push(id);
    removed.add(`${table}:${id}`);
  };
  canDelete("instances", after.instance, receipt.createdInstance);
  canDelete("editions", after.edition, receipt.createdEdition);
  canDelete("works", after.work, receipt.workCreated);
  for (const author of after.authors)
    canDelete(
      "authors",
      author,
      receipt.authorIdsCreated.includes(String(author.id)),
    );
  canDelete("series", after.series, !!receipt.seriesIdCreated);
  // Activities have polymorphic entity ids and no FK. Remove only the exact
  // creation activity whose target is also being removed by this operation.
  const activityIds = after.activities
    .filter((saved) => {
      const current = rows("activity_events").find(
        (row) => row.id === saved.id,
      );
      const metadata = saved.metadata as Record<string, unknown> | null;
      return (
        !!current &&
        same(current, saved) &&
        receipt.activityIdsCreated.includes(String(saved.id)) &&
        ((saved.event_key === "author.created" &&
          deleted.authors.includes(String(saved.entity_id))) ||
          (saved.event_key === "work.created" &&
            deleted.works.includes(String(saved.entity_id))) ||
          (saved.event_key === "work.edition_added" &&
            deleted.editions.includes(String(metadata?.targetId))) ||
          (saved.event_key === "work.instance_added" &&
            deleted.instances.includes(String(metadata?.targetId))))
      );
    })
    .map((row) => String(row.id));
  const jobIds = rows("enrichment_jobs")
    .filter(
      (row) =>
        deleted.works.includes(String(row.work_id)) &&
        owned("works", "enrichment_jobs", row),
    )
    .map((row) => String(row.id));
  return { deleted, activityIds, jobIds, restoreCopy, retained };
}
export interface UndoLinkPlan extends MatchOperationIdentity {
  kind: "undo_link";
  mode: "classification_only";
  createdAt: string;
  modelFingerprint: string;
  snapshot: Pick<
    LoadedMatchCatalogue,
    "rows" | "catalogueFingerprint" | "inputFingerprint"
  >;
  dependencies: DependencySnapshot;
  receipt: LinkReceipt;
  cleanup: UndoCleanup;
  classification: MatchResult;
  restoreUpdatedAt: string | null;
}
export type UndoLinkPlanning =
  | { kind: "unchanged"; reason: "missing_or_later_operation" }
  | { kind: "planned"; plan: UndoLinkPlan };
export async function planUndoLinkOn(
  conn: Db,
  entry: LinkReceipt,
  target: string,
  now = new Date().toISOString(),
): Promise<UndoLinkPlanning> {
  if (entry.targetDatabase !== target || entry.version !== 1)
    throw new Error("Undo target or receipt version changed");
  const loaded = await loadMatchCatalogue(conn);
  const stored = loaded.rows.ebooks.find((row) => row.id === entry.ebookId);
  const receipt = stored?.link_written as LinkReceipt | null;
  if (
    !stored ||
    !receipt ||
    !identityMatches(receipt, entry) ||
    receipt.ebookId !== entry.ebookId ||
    receipt.instanceId !== stored.instance_id ||
    stored.match_state !== "linked"
  )
    return { kind: "unchanged", reason: "missing_or_later_operation" };
  const dependencies = await loadMatchDependencies(conn);
  const cleanup = decideUndoCleanup(receipt, loaded, dependencies);
  const pending = {
    ...loaded.catalogue.source.ebooks.find((row) => row.id === entry.ebookId)!,
    instanceId: null,
    matchState: "pending" as const,
    matchFingerprint: null,
    exclusionReason: null,
  };
  const source = loaded.catalogue.source;
  const catalogue = indexCatalogue({
    ...source,
    ebooks: source.ebooks.map((ebook) =>
      ebook.id === pending.id ? pending : ebook,
    ),
    authors: source.authors.filter(
      (author) => !cleanup.deleted.authors.includes(author.id),
    ),
    works: source.works
      .filter((work) => !cleanup.deleted.works.includes(work.id))
      .map((work) => ({
        ...work,
        editions: work.editions.filter(
          (edition) => !cleanup.deleted.editions.includes(edition.id),
        ),
        copies: work.copies
          .filter((copy) => !cleanup.deleted.instances.includes(copy.id))
          .map((copy) =>
            copy.id === receipt.instanceId
              ? {
                  ...copy,
                  linkedEbookId: null,
                  ...(cleanup.restoreCopy
                    ? {
                        editionId: cleanup.restoreCopy.editionId,
                        updatedAt: String(cleanup.restoreCopy.updatedAt),
                      }
                    : {}),
                }
              : copy,
          ),
      })),
  });
  const plan: UndoLinkPlan = {
    version: 1,
    operationId: randomUUID(),
    runId: entry.runId,
    planSha256: "",
    targetDatabase: target,
    kind: "undo_link",
    mode: "classification_only",
    createdAt: now,
    modelFingerprint: dataFingerprint(MATCH_MODEL),
    snapshot: {
      rows: loaded.rows,
      catalogueFingerprint: loaded.catalogueFingerprint,
      inputFingerprint: loaded.inputFingerprint,
    },
    dependencies,
    receipt,
    cleanup,
    classification: matchOne(pending, catalogue),
    restoreUpdatedAt: same(
      Object.fromEntries(
        Object.entries(stored).filter(([key]) => key !== "link_written"),
      ),
      receipt.after!.ebook,
    )
      ? String(receipt.before.ebook.updated_at)
      : null,
  };
  plan.planSha256 = hashMatchingPlan(plan);
  return { kind: "planned", plan };
}
export async function planUndoLink(url: string, entry: LinkReceipt) {
  return withReadOnlyPlanningConnection(
    url,
    (conn) => planUndoLinkOn(conn, entry, databaseFingerprint(url)),
    { isolationLevel: "repeatable read" },
  );
}
export async function undoLink(conn: Db, plan: UndoLinkPlan, target: string) {
  if (
    plan.kind !== "undo_link" ||
    plan.mode !== "classification_only" ||
    plan.targetDatabase !== target ||
    plan.planSha256 !== hashMatchingPlan(plan) ||
    plan.modelFingerprint !== dataFingerprint(MATCH_MODEL)
  )
    throw new Error("Undo identity, mode, model or hash changed");
  const at = new Date(plan.createdAt);
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid undo timestamp");
  const classificationAt = plan.restoreUpdatedAt
    ? new Date(plan.restoreUpdatedAt)
    : at;
  if (!Number.isFinite(classificationAt.getTime()))
    throw new Error("Invalid original ebook timestamp");
  return withReadableErrors(() =>
    atomicOn(conn, (d) => [
      ...snapshotGuardQueries(
        d,
        plan.snapshot,
        Object.keys(plan.dependencies.rows),
      ),
      ...Object.entries(plan.dependencies.rows).map(([table, rows]) =>
        d.execute(
          assertSql(
            dependencyGuardCondition(table, rows),
            `Undo dependency changed in ${table}; nothing removed`,
          ),
        ),
      ),
      d
        .delete(ebookMatchCandidates)
        .where(eq(ebookMatchCandidates.ebookId, plan.receipt.ebookId)),
      d
        .update(ebooks)
        .set({
          instanceId: null,
          matchState: "pending",
          matchMethod: null,
          matchProbability: null,
          matchedAt: null,
          linkWritten: null,
          matchTier: null,
          duplicateOfId: null,
          exclusionReason: null,
          updatedAt: at,
        })
        .where(eq(ebooks.id, plan.receipt.ebookId)),
      ...(plan.cleanup.restoreCopy
        ? [
            d.execute(
              sql`update instances set edition_id=${plan.cleanup.restoreCopy.editionId}::uuid, updated_at=${String(plan.cleanup.restoreCopy.updatedAt)}::timestamptz where id=${plan.cleanup.restoreCopy.id}::uuid`,
            ),
          ]
        : []),
      ...(plan.cleanup.activityIds.length
        ? [
            d.execute(
              sql`delete from activity_events where id=any(${[...plan.cleanup.activityIds]}::uuid[])`,
            ),
          ]
        : []),
      ...(plan.cleanup.jobIds.length
        ? [
            d.execute(
              sql`delete from enrichment_jobs where id=any(${[...plan.cleanup.jobIds]}::uuid[])`,
            ),
          ]
        : []),
      ...(
        ["instances", "editions", "works", "authors", "series"] as const
      ).flatMap((table) =>
        plan.cleanup.deleted[table].length
          ? [
              d.execute(
                sql`delete from ${sql.identifier(table)} where id=any(${[...plan.cleanup.deleted[table]]}::uuid[])`,
              ),
            ]
          : [],
      ),
      ...classificationQueries(
        d,
        [plan.classification],
        classificationAt,
      ),
    ]),
  );
}
