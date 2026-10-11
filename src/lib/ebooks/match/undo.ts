import { uuidArraySql } from "@/lib/db/sql-arrays";
import { requireCoreAtomicExtension, uploadCompensation, uploadTimestamp, requireUploadUndoOriginal, type PreparedCoreAtomicExtension } from "./atomic-extension";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { ebooks, ebookMatchCandidates } from "@/lib/db/schema";
import { atomicOn } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { databaseFingerprint } from "../ingest/command";
import { indexCatalogue } from "./catalogue";
import { classificationQueries } from "./classification";
import {
  loadMatchDependencies,
  referencingRows,
  dependencyGuardCondition,
  dependencyReferenceGuardCondition,
  type DependencySnapshot,
} from "./dependencies";
import { snapshotGuardQueries } from "./guards";
import {
  dataFingerprint,
  loadMatchCatalogue,
  type LoadedMatchCatalogue,
  type StoredRow,
} from "./load";
import { immutableMatchingWriterInput, type LinkReceipt } from "./link";
import { copyMetadataRestoration, EXISTING_COPY_METADATA_COLUMNS } from "./existing-copy";
import type { EditableInstanceMetadataPatch } from "./manual-intents";
import { MATCH_MODEL } from "./model";
import { hashMatchingPlan } from "./plan";
import { matchOne } from "./tiers";
import type { MatchOperationIdentity, MatchResult } from "./types";
import {
  verifyReviewCompensationOn, parseReviewCompensation, reviewCompensationGuardQueries,
  reviewForwardUpdatedAt, type ReviewCompensation,
} from "./review-extension";
import {
  matchingOperationOf, parseReviewUnlinkPolicy, readMatchingUnlinkAfterOn,
  reviewUnlinkGuardQueries, reviewUnlinkForwardUpdatedAt,
  type ReviewUnlinkPolicy, type ReviewUnlinkPlanning, type ReviewedUnlinkCore,
} from "../review/unlink-contract";
import { ebookRawSnapshotSql, ebookSnapshotSql, ebookSnapshotTimesAreValidSql } from "../review/store-sql";
import { canonicalReviewJson } from "../review/receipts";
import { ReviewError } from "../review/errors";

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
  restoreCopy: {
    id: string; editionId: string; updatedAt: unknown;
    format?: unknown; fileSizeBytes?: unknown;
    metadata?: EditableInstanceMetadataPatch;
  } | null;
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
  if (receipt.movedFromEditionId || receipt.fillProvenance || receipt.metadataProvenance) {
    const before = receipt.before.instance;
    const current = loaded.rows.instances.find(
      (row) => row.id === receipt.instanceId,
    );
    const originalEdition = loaded.rows.editions.find(
      (row) => row.id === (receipt.movedFromEditionId ?? receipt.editionId),
    );
    const marker = receipt.fillProvenance;
    let restoredMetadata: EditableInstanceMetadataPatch | undefined;
    let metadataComplete = true;
    if (receipt.metadataProvenance) {
      try {
        if (!before || receipt.createdInstance || receipt.movedFromEditionId || !receipt.fillProvenance ||
            receipt.kind !== "link") throw new Error("Existing metadata patch has another writer scope");
        restoredMetadata = copyMetadataRestoration(before, after.instance, receipt.metadataProvenance);
      } catch { metadataComplete = false; }
    }
    const complete = metadataComplete && !receipt.createdInstance && !!before && before.id === receipt.instanceId &&
      before.edition_id === (receipt.movedFromEditionId ?? receipt.editionId) &&
      typeof before.updated_at === "string" &&
      (!marker || (
        (!receipt.movedFromEditionId || !!receipt.before.originalEdition) &&
        typeof marker === "object" && marker !== null &&
        typeof marker.expected === "object" && marker.expected !== null &&
        Object.keys(marker).sort().join(",") === "expected,fields" &&
        Object.keys(marker.expected).sort().join(",") === "fileSizeBytes,format" &&
        Array.isArray(marker.fields) && new Set(marker.fields).size === marker.fields.length &&
        marker.fields.every((field) => field === "format" || field === "file_size_bytes") &&
        Object.hasOwn(before, "format") && Object.hasOwn(before, "file_size_bytes") &&
        (before.format === null || typeof before.format === "string") &&
        (before.file_size_bytes === null || (typeof before.file_size_bytes === "number" &&
          Number.isSafeInteger(before.file_size_bytes) && before.file_size_bytes >= 0)) &&
        ["epub", "pdf", "ebook"].includes(marker.expected.format) &&
        Number.isSafeInteger(marker.expected.fileSizeBytes) && marker.expected.fileSizeBytes >= 0 &&
        marker.expected.format === after.instance.format &&
        marker.expected.fileSizeBytes === after.instance.file_size_bytes &&
        same([...marker.fields].sort(), (["format", "file_size_bytes"] as const)
          .filter((field) => before[field] !== after.instance[field]).sort())
      ));
    // A later reading/annotation or unknown FK remains use even when it did not
    // touch updated_at. Only the ebook edge removed by this undo is excluded.
    const referenced = current && referencingRows(dependencies, "instances", current).some(
      ({ table, row }) => !(table === "ebooks" && row.id === receipt.ebookId &&
        row.instance_id === receipt.instanceId),
    );
    const savedParent = receipt.movedFromEditionId ? receipt.before.originalEdition : after.edition;
    const parentChanged = !originalEdition || originalEdition.work_id !== receipt.workId ||
      originalEdition.metadata_locked === true ||
      (!!savedParent && !same(originalEdition, savedParent));
    const parentTaken = !!receipt.movedFromEditionId && loaded.rows.instances.some((row) =>
      row.id !== receipt.instanceId && row.edition_id === receipt.movedFromEditionId &&
      loaded.rows.ebooks.some((ebook) => ebook.instance_id === row.id),
    );
    const reason = !complete ? "incomplete or inconsistent fill/move provenance" :
      !current || !same(current, after.instance) ? "edited copy" :
      referenced ? "referenced copy" : parentChanged ? "original edition changed" :
      parentTaken ? "original edition is now used by another linked copy" : null;
    if (!reason && before)
      restoreCopy = {
        id: receipt.instanceId,
        editionId: String(before.edition_id),
        updatedAt: before.updated_at,
        ...(restoredMetadata !== undefined ? { metadata: restoredMetadata } : {}),
        ...(marker?.fields.includes("format") ? { format: before.format } : {}),
        ...(marker?.fields.includes("file_size_bytes") ? { fileSizeBytes: before.file_size_bytes } : {}),
      };
    else
      retained.push({
        table: "instances",
        id: receipt.instanceId,
        reason: reason ?? "copy restoration is not proven",
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
  reviewCompensation?: ReviewCompensation;
  reviewUnlink?: ReviewUnlinkPolicy;
}
export type UndoLinkPlanning =
  | { kind: "unchanged"; reason: "missing_or_later_operation" }
  | { kind: "planned"; plan: UndoLinkPlan };
/** Both projections come from the supplied protected planning connection.
 * The raw JSON row also binds the matching catalogue snapshot used for cleanup;
 * normalized timestamp text is compared only with database-produced text. */
async function verifyReviewUnlinkOn(
  conn: Db, policy: ReviewUnlinkPolicy, stored: StoredRow,
): Promise<ReviewUnlinkPolicy> {
  const rows = resultRows<{ text: string; stamp: unknown; valid: boolean; row: StoredRow }>(
    await conn.execute(sql`select ${ebookRawSnapshotSql()} as text,
      ${ebookSnapshotSql()} as stamp, ${ebookSnapshotTimesAreValidSql()} as valid,
      to_jsonb(e) as row from ebooks e where e.id=${policy.ebookId}::uuid`),
  );
  const matchingAfter = await readMatchingUnlinkAfterOn(conn, policy.ebookId);
  if (rows.length !== 1 || !rows[0].valid || rows[0].text !== policy.rawEbookSnapshotText ||
      matchingAfter !== policy.matchingAfterEbookText || !same(rows[0].row, stored) ||
      canonicalReviewJson(rows[0].stamp) !== canonicalReviewJson(policy.expectedCurrent))
    throw new ReviewError("stale_review", "This eBook changed. Prepare a new unlink review.");
  return policy;
}
export function planUndoLinkOn(
  conn: Db, entry: LinkReceipt, target: string, now: string | undefined,
  options: { reviewUnlink: ReviewUnlinkPolicy; reviewCompensation?: never },
): Promise<ReviewUnlinkPlanning>;
export function planUndoLinkOn(
  conn: Db, entry: LinkReceipt, target: string, now?: string,
  options?: { reviewCompensation?: ReviewCompensation; reviewUnlink?: ReviewUnlinkPolicy },
): Promise<UndoLinkPlanning>;
export async function planUndoLinkOn(
  conn: Db,
  entry: LinkReceipt,
  target: string,
  now = new Date().toISOString(),
  options: { reviewCompensation?: ReviewCompensation; reviewUnlink?: ReviewUnlinkPolicy } = {},
): Promise<UndoLinkPlanning> {
  entry = immutableMatchingWriterInput(entry);
  options = immutableMatchingWriterInput(options);
  if (options.reviewCompensation !== undefined && options.reviewUnlink !== undefined)
    throw new Error("Review unlink and compensation policies are mutually exclusive");
  let reviewUnlink = options.reviewUnlink === undefined ? undefined : parseReviewUnlinkPolicy(options.reviewUnlink);
  if (reviewUnlink && (reviewUnlink.ebookId !== entry.ebookId ||
      reviewUnlink.originalMatchingOperation.targetDatabase !== target ||
      canonicalReviewJson(reviewUnlink.originalMatchingOperation) !== canonicalReviewJson(matchingOperationOf(entry))))
    throw new ReviewError("stale_review", "The original matching operation changed.");
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
  if (reviewUnlink) reviewUnlink = await verifyReviewUnlinkOn(conn, reviewUnlink, stored);
  let reviewCompensation: ReviewCompensation | undefined;
  if (options.reviewCompensation !== undefined) {
    const policy = parseReviewCompensation(options.reviewCompensation);
    if (policy.originalOperation.targetDatabase !== target ||
        policy.originalOperation.runId !== entry.runId ||
        !receipt.after || !same(
          Object.fromEntries(Object.entries(stored).filter(([key]) => key !== "link_written")),
          receipt.after.ebook,
        )) throw new Error("Review undo requires the unchanged full committed matching after-state");
    reviewCompensation = await verifyReviewCompensationOn(
      conn, policy, entry.ebookId, ["accept", "link", "accession"], { rows: loaded.rows },
    );
  }
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
    ...(reviewCompensation ? { reviewCompensation } : {}),
    ...(reviewUnlink ? { reviewUnlink } : {}),
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
export async function undoLink(
  conn: Db, plan: UndoLinkPlan, target: string,
  options: { atomicExtension?: PreparedCoreAtomicExtension } = {},
) {
  plan = immutableMatchingWriterInput(plan);
  // Keep the issued capability's private registry identity; clone only DTOs.
  const atomicExtension = options.atomicExtension;
  if (plan.reviewCompensation !== undefined && plan.reviewUnlink !== undefined)
    throw new Error("Review unlink and compensation policies are mutually exclusive");
  if (
    plan.kind !== "undo_link" ||
    plan.mode !== "classification_only" ||
    plan.targetDatabase !== target ||
    plan.planSha256 !== hashMatchingPlan(plan) ||
    plan.modelFingerprint !== dataFingerprint(MATCH_MODEL)
  )
    throw new Error("Undo identity, mode, model or hash changed");
  const extension = requireCoreAtomicExtension(atomicExtension, {
    coreWriter: "undo_link", coreOperation: plan, ebookIds: [plan.receipt.ebookId],
    compensation: plan.reviewCompensation,
    reviewUnlink: plan.reviewUnlink,
  });
  if (uploadCompensation(extension)) requireUploadUndoOriginal(extension!, plan.receipt);
  if (plan.reviewUnlink) {
    const stored = plan.snapshot.rows.ebooks.find((row) => row.id === plan.receipt.ebookId);
    const raw = JSON.parse(plan.reviewUnlink.rawEbookSnapshotText) as StoredRow;
    if (plan.reviewUnlink.ebookId !== plan.receipt.ebookId || !stored ||
        stored.match_state !== "linked" || stored.instance_id !== plan.receipt.instanceId ||
        !same(stored.link_written, plan.receipt) || !same(raw.link_written, plan.receipt) ||
        canonicalReviewJson(plan.reviewUnlink.originalMatchingOperation) !== canonicalReviewJson(matchingOperationOf(plan.receipt)))
      throw new Error("Review unlink differs from the original matching operation");
  }
  if (plan.reviewCompensation && (!plan.receipt.after || !same(
    Object.fromEntries(Object.entries(plan.snapshot.rows.ebooks.find((row) => row.id === plan.receipt.ebookId) ?? {})
      .filter(([key]) => key !== "link_written")), plan.receipt.after.ebook,
  ))) throw new Error("Review undo lacks the exact committed matching after-state");
  const at = new Date(plan.createdAt);
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid undo timestamp");
  const classificationAt = !plan.reviewCompensation && !plan.reviewUnlink && !uploadCompensation(extension) && plan.restoreUpdatedAt
    ? new Date(plan.restoreUpdatedAt)
    : at;
  if (!Number.isFinite(classificationAt.getTime()))
    throw new Error("Invalid original ebook timestamp");
  return withReadableErrors(() =>
    atomicOn(conn, (d) => [
      ...snapshotGuardQueries(
        d,
        plan.snapshot,
        ["enrichment_jobs", ...Object.keys(plan.dependencies.rows), ...(extension?.extraTables ?? [])],
      ),
      d.execute(assertSql(dependencyReferenceGuardCondition(plan.dependencies.references),
        "Undo foreign references changed; make a new plan")),
      ...Object.entries(plan.dependencies.rows).map(([table, rows]) =>
        d.execute(
          assertSql(
            dependencyGuardCondition(table, rows),
            `Undo dependency changed in ${table}; nothing removed`,
          ),
        ),
      ),
      ...(plan.reviewCompensation ? reviewCompensationGuardQueries(
        d, plan.reviewCompensation, plan.receipt.ebookId, ["accept", "link", "accession"],
      ) : []),
      ...(plan.reviewUnlink ? reviewUnlinkGuardQueries(d, plan.reviewUnlink) : []),
      ...(extension?.before(d) ?? []),
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
          updatedAt: plan.reviewCompensation ? reviewForwardUpdatedAt(plan.reviewCompensation)
            : plan.reviewUnlink ? reviewUnlinkForwardUpdatedAt(plan.reviewUnlink) : uploadTimestamp(extension, at),
        })
        .where(eq(ebooks.id, plan.receipt.ebookId)),
      ...(plan.cleanup.restoreCopy
        ? [
            d.execute(
              sql`update instances set edition_id=${plan.cleanup.restoreCopy.editionId}::uuid,
                ${Object.hasOwn(plan.cleanup.restoreCopy, "format") ? sql`format=${plan.cleanup.restoreCopy.format as string | null},` : sql``}
                ${Object.hasOwn(plan.cleanup.restoreCopy, "fileSizeBytes") ? sql`file_size_bytes=${plan.cleanup.restoreCopy.fileSizeBytes as number | null},` : sql``}
                ${plan.cleanup.restoreCopy.metadata !== undefined ? sql.join(
                  Object.entries(plan.cleanup.restoreCopy.metadata).map(([key, value]) => sql`${sql.identifier(
                    EXISTING_COPY_METADATA_COLUMNS[key as keyof typeof EXISTING_COPY_METADATA_COLUMNS])}=${value},`), sql` `) : sql``}
                updated_at=${uploadCompensation(extension)
                  ? sql`greatest(clock_timestamp(),updated_at+interval '1 microsecond')`
                  : plan.cleanup.restoreCopy.metadata !== undefined
                    ? sql`greatest(updated_at, ${at.toISOString()}::timestamptz) + interval '1 microsecond'`
                    : sql`${String(plan.cleanup.restoreCopy.updatedAt)}::timestamptz`} where id=${plan.cleanup.restoreCopy.id}::uuid`,
            ),
          ]
        : []),
      ...(plan.cleanup.activityIds.length
        ? [
            d.execute(
              sql`delete from activity_events where id=any(${uuidArraySql(plan.cleanup.activityIds)})`,
            ),
          ]
        : []),
      ...(plan.cleanup.jobIds.length
        ? [
            d.execute(
              sql`delete from enrichment_jobs where id=any(${uuidArraySql(plan.cleanup.jobIds)})`,
            ),
          ]
        : []),
      ...(
        ["instances", "editions", "works", "authors", "series"] as const
      ).flatMap((table) =>
        plan.cleanup.deleted[table].length
          ? [
              d.execute(
                sql`delete from ${sql.identifier(table)} where id=any(${uuidArraySql(plan.cleanup.deleted[table])})`,
              ),
            ]
          : [],
      ),
      ...classificationQueries(
        d,
        [plan.classification],
        classificationAt,
        plan.reviewCompensation || plan.reviewUnlink || uploadCompensation(extension) ? { touchEbook: false } : {},
      ),
      ...(extension?.after(d) ?? []),
    ]),
  );
}

/** The review store owns capability issuance and the final receipt suffix. */
export const reviewedUnlinkCore = {
  planOn: planUndoLinkOn,
  write: undoLink,
} satisfies ReviewedUnlinkCore;
