import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { requireBookWork } from "@/lib/catalogue/book-boundary";
import { isbnClash } from "@/lib/catalogue/isbn-clash";
import { planBookEdition } from "@/lib/catalogue/book-store";
import { atomicOn } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import {
  activityEvents,
  ebooks,
  ebookMatchCandidates,
  instances,
  instanceStatusHistory,
} from "@/lib/db/schema";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { databaseFingerprint } from "../ingest/command";
import {
  loadMatchCatalogue,
  dataFingerprint,
  type LoadedMatchCatalogue,
  type StoredRow,
} from "./load";
import { editionEffect } from "./editions";
import { matchFingerprint } from "./keys";
import { scorePair } from "./score";
import { MATCH_MODEL } from "./model";
import { hashMatchingPlan } from "./plan";
import { snapshotGuardQueries } from "./guards";
import { requireMatchProbability } from "./validation";
import type { LinkEffect, MatchEbook, MatchOperationIdentity } from "./types";
import { requireApprovedGroupPlan, type ApprovedGroupMatching } from "./groups";
import { planCoverCopy, copyPlannedCover, discardUnusedCover } from "./covers";

export interface LinkChoices {
  ebookId: string;
  workId: string;
  instanceId?: string;
  editionId?: string;
  locationId?: string;
  method: "manual" | "isbn" | "identifier" | "score";
  probability?: number | null;
}
export interface LinkPlan extends MatchOperationIdentity {
  kind: "link";
  mode: "ingestion";
  modelFingerprint: string;
  createdAt: string;
  snapshot: Pick<
    LoadedMatchCatalogue,
    "rows" | "catalogueFingerprint" | "inputFingerprint"
  >;
  ebook: MatchEbook;
  effect: LinkEffect;
  choices: LinkChoices;
  editionId: string;
  instanceId: string;
  instanceHistoryId: string | null;
  activityId: string | null;
  editionActivityId: string | null;
  approvedGroupHash?: string;
}
export interface LinkReceipt extends MatchOperationIdentity {
  kind: "link" | "accession";
  ebookId: string;
  workId: string;
  instanceId: string;
  editionId: string;
  createdInstance: boolean;
  createdEdition: boolean;
  movedFromEditionId: string | null;
  workCreated: boolean;
  authorIdsCreated: readonly string[];
  seriesIdCreated: string | null;
  historyIdsCreated: readonly string[];
  activityIdsCreated: readonly string[];
  coverArtifacts?: readonly string[];
  approvedGroupHash?: string;
  before: {
    ebook: StoredRow;
    instance: StoredRow | null;
    candidates: readonly StoredRow[];
  };
  /** The transaction fills these full JSON row snapshots, without recursion. */
  after?: {
    ebook: StoredRow;
    instance: StoredRow;
    edition: StoredRow;
    work: StoredRow;
    authors: readonly StoredRow[];
    series: StoredRow | null;
    histories: readonly StoredRow[];
    activities: readonly StoredRow[];
    ownedChildren: Readonly<Record<string, readonly StoredRow[]>>;
  };
}
export async function planLinkOn(
  conn: Db,
  input: LinkChoices,
  identity: { runId: string; targetDatabase: string; now?: string },
): Promise<LinkPlan> {
  requireMatchProbability(input.probability ?? null);
  const loaded = await loadMatchCatalogue(conn);
  await requireBookWork(input.workId, conn);
  const work = loaded.catalogue.byWorkId.get(input.workId);
  const ebook = loaded.catalogue.source.ebooks.find(
    (row) => row.id === input.ebookId,
  );
  if (!work || !ebook || ebook.instanceId || ebook.matchState === "linked")
    throw new Error("Choose an existing unlinked ebook and book");
  const effect = editionEffect(ebook, work, loaded.catalogue, input);
  const score = scorePair(ebook, work, loaded.catalogue);
  if (score.identifierConflict)
    throw new Error(
      "An identifier contradicts this book; review metadata before linking",
    );
  if (!effect.ready) throw new Error(effect.text);
  if (effect.newEdition?.isbn13) {
    const clash = await isbnClash(
      { isbn13: effect.newEdition.isbn13 },
      undefined,
      conn,
    );
    if (clash) throw new Error(clash);
  }
  if (input.method !== "manual")
    throw new Error(
      "Automatic links require the approved group/calibration apply boundary",
    );
  const plan: LinkPlan = {
    version: 1,
    operationId: randomUUID(),
    runId: identity.runId,
    planSha256: "",
    targetDatabase: identity.targetDatabase,
    kind: "link",
    mode: "ingestion",
    createdAt: identity.now ?? new Date().toISOString(),
    modelFingerprint: dataFingerprint(MATCH_MODEL),
    snapshot: {
      rows: loaded.rows,
      catalogueFingerprint: loaded.catalogueFingerprint,
      inputFingerprint: loaded.inputFingerprint,
    },
    ebook,
    effect,
    choices: { ...input },
    editionId: effect.editionId ?? randomUUID(),
    instanceId: effect.instanceId ?? randomUUID(),
    instanceHistoryId: effect.instanceId ? null : randomUUID(),
    activityId: effect.newCopy ? randomUUID() : null,
    editionActivityId: effect.newEdition ? randomUUID() : null,
  };
  plan.planSha256 = hashMatchingPlan(plan);
  return plan;
}
export async function planLink(
  url: string,
  input: LinkChoices,
  identity: { runId?: string; now?: string } = {},
) {
  return withReadOnlyPlanningConnection(
    url,
    (conn) =>
      planLinkOn(conn, input, {
        runId: identity.runId ?? randomUUID(),
        targetDatabase: databaseFingerprint(url),
        now: identity.now,
      }),
    { isolationLevel: "repeatable read" },
  );
}
export function linkUndoEntry(plan: LinkPlan): LinkReceipt {
  const before = plan.snapshot.rows.ebooks.find(
    (row) => row.id === plan.ebook.id,
  );
  if (!before)
    throw new Error("Link plan is missing its original ebook snapshot");
  return {
    version: 1,
    operationId: plan.operationId,
    runId: plan.runId,
    planSha256: plan.planSha256,
    targetDatabase: plan.targetDatabase,
    kind: "link",
    ebookId: plan.ebook.id,
    workId: plan.effect.workId,
    instanceId: plan.instanceId,
    editionId: plan.editionId,
    createdInstance: !!plan.effect.newCopy,
    createdEdition: !!plan.effect.newEdition,
    movedFromEditionId: plan.effect.movedFromEditionId,
    workCreated: false,
    authorIdsCreated: [],
    seriesIdCreated: null,
    historyIdsCreated: plan.instanceHistoryId ? [plan.instanceHistoryId] : [],
    activityIdsCreated: [
      ...(plan.activityId ? [plan.activityId] : []),
      ...(plan.editionActivityId ? [plan.editionActivityId] : []),
    ],
    ...(plan.approvedGroupHash
      ? { approvedGroupHash: plan.approvedGroupHash }
      : {}),
    before: {
      ebook: before,
      instance: plan.effect.instanceId
        ? (plan.snapshot.rows.instances.find(
            (row) => row.id === plan.effect.instanceId,
          ) ?? null)
        : null,
      candidates: plan.snapshot.rows.ebook_match_candidates.filter(
        (row) => row.ebook_id === plan.ebook.id,
      ),
    },
  };
}
/** Captures full committed row values inside the atomic, not a later read.
 * The same bound identity is in reserved CLI undo entries and DB provenance. */
export function commitReceiptQuery(d: Db, receipt: LinkReceipt) {
  return d.execute(sql`update ebooks eb set link_written = ${JSON.stringify(receipt)}::jsonb || jsonb_build_object('after', jsonb_build_object(
    'ebook', to_jsonb(eb) - 'link_written',
    'instance', (select to_jsonb(i) from instances i where i.id=${receipt.instanceId}::uuid),
    'edition', (select to_jsonb(e) from editions e where e.id=${receipt.editionId}::uuid),
    'work', (select to_jsonb(w) from works w where w.id=${receipt.workId}::uuid),
    'authors', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from authors a where a.id=any(${[...receipt.authorIdsCreated]}::uuid[])),
    'series', (select to_jsonb(s) from series s where s.id=${receipt.seriesIdCreated}::uuid),
    'histories', (select coalesce(jsonb_agg(row order by row::text), '[]'::jsonb) from (select to_jsonb(h) row from instance_status_history h where h.id=any(${[...receipt.historyIdsCreated]}::uuid[]) union all select to_jsonb(h) row from work_status_history h where h.id=any(${[...receipt.historyIdsCreated]}::uuid[])) h),
    'activities', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from activity_events a where a.id=any(${[...receipt.activityIdsCreated]}::uuid[])),
    'ownedChildren', jsonb_build_object(
      'work_authors', (select coalesce(jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),'[]'::jsonb) from work_authors c where ${receipt.workCreated} and c.work_id=${receipt.workId}::uuid),
      'person_domains', (select coalesce(jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),'[]'::jsonb) from person_domains c where c.person_id=any(${[...receipt.authorIdsCreated]}::uuid[]) and c.kind='book')
    )
  )) where eb.id=${receipt.ebookId}::uuid returning link_written`);
}
export async function prepareLinkWrite(
  plan: LinkPlan,
  runtimeTarget: string,
  options: {
    preparedCover?: NonNullable<Parameters<typeof planBookEdition>[1]>["cover"];
    automaticApproval?: ApprovedGroupMatching;
  } = {},
) {
  if (
    plan.kind !== "link" ||
    plan.version !== 1 ||
    plan.mode !== "ingestion" ||
    plan.targetDatabase !== runtimeTarget ||
    plan.modelFingerprint !== dataFingerprint(MATCH_MODEL) ||
    plan.planSha256 !== hashMatchingPlan(plan) ||
    !plan.effect.ready
  )
    throw new Error(
      "Link mode, target, model, hash or effect changed; nothing written",
    );
  requireMatchProbability(plan.choices.probability ?? null);
  if (plan.choices.method !== "manual") {
    const approval = options.automaticApproval;
    if (
      !approval?.precision ||
      plan.approvedGroupHash !== dataFingerprint(approval.plan)
    )
      throw new Error("Automatic link lacks the bound approved group plan");
    requireApprovedGroupPlan(approval);
    const approved = approval.plan.groups.find(
      (group) =>
        group.metadataFingerprint === matchFingerprint(plan.ebook) &&
        group.result.autoLink &&
        dataFingerprint(group.result.candidates[0]?.effect) ===
          dataFingerprint(plan.effect),
    );
    if (
      !approved ||
      approved.result.candidates[0].probability !== plan.choices.probability ||
      approved.result.candidates[0].workId !== plan.choices.workId ||
      (approved.result.candidates[0].identifierMethods[0] ?? "score") !== plan.choices.method
    )
      throw new Error("Automatic effect differs from the reviewed candidate");
  }
  const at = new Date(plan.createdAt);
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid link timestamp");
  const { coverSourceKey: _coverSourceKey, ...editionValues } =
    plan.effect.newEdition ?? {};
  const editionPlan = plan.effect.newEdition
    ? await planBookEdition(
        { workId: plan.effect.workId, ...editionValues } as Parameters<
          typeof planBookEdition
        >[0],
        {
          id: plan.editionId,
          activityId: plan.editionActivityId!,
          at,
          cover: options.preparedCover ?? null,
        },
      )
    : null;
  const receipt: LinkReceipt = {
    ...linkUndoEntry(plan),
    ...(options.preparedCover
      ? {
          coverArtifacts: [
            options.preparedCover.coverKey,
            options.preparedCover.thumbnailKey,
          ],
        }
      : {}),
  };
  return {
    receipt,
    queries: (d: Db) => [
      d
        .delete(ebookMatchCandidates)
        .where(eq(ebookMatchCandidates.ebookId, plan.ebook.id)),
      ...(editionPlan?.queries(d) ?? []),
      ...(plan.effect.newCopy
        ? [
            d.insert(instances).values({
              id: plan.instanceId,
              editionId: plan.editionId,
              ...plan.effect.newCopy,
              createdAt: at,
              updatedAt: at,
            }),
            d.insert(instanceStatusHistory).values({
              id: plan.instanceHistoryId!,
              instanceId: plan.instanceId,
              fromStatus: null,
              toStatus: "available",
              changedAt: at,
              notes: `ebook operation ${plan.operationId}`,
            }),
            d.insert(activityEvents).values({
              id: plan.activityId!,
              entityType: "work",
              entityId: plan.effect.workId,
              eventKey: "work.instance_added",
              metadata: { targetId: plan.instanceId },
              createdAt: at,
            }),
          ]
        : []),
      ...(plan.effect.movedFromEditionId
        ? [
            d
              .update(instances)
              .set({ editionId: plan.editionId, updatedAt: at })
              .where(eq(instances.id, plan.instanceId)),
          ]
        : []),
      d
        .update(ebooks)
        .set({
          instanceId: plan.instanceId,
          matchState: "linked",
          matchMethod: plan.choices.method,
          matchProbability: plan.choices.probability ?? null,
          matchedAt: at,
          matchFingerprint: matchFingerprint(plan.ebook),
          matchModelVersion: MATCH_MODEL.version,
          matchTier: null,
          duplicateOfId: null,
          exclusionReason: null,
          updatedAt: at,
        })
        .where(eq(ebooks.id, plan.ebook.id)),
      commitReceiptQuery(d, receipt),
    ],
  };
}
export async function linkEbook(
  conn: Db,
  plan: LinkPlan,
  runtimeTarget: string,
  options: Parameters<typeof prepareLinkWrite>[2] & {
    beforeWrite?: (entry: LinkReceipt) => Promise<void>;
  } = {},
) {
  const coverPlan = options.preparedCover
    ? null
    : planCoverCopy(
        plan.snapshot,
        plan.ebook.id,
        plan.editionId,
        plan.effect.newEdition?.coverSourceKey ?? null,
      );
  let prepared = await prepareLinkWrite(plan, runtimeTarget, {
    ...options,
    preparedCover: coverPlan
      ? { ...coverPlan, palette: null }
      : options.preparedCover,
  });
  await options.beforeWrite?.(prepared.receipt);
  try {
    if (coverPlan)
      prepared = await prepareLinkWrite(plan, runtimeTarget, {
        ...options,
        preparedCover: await copyPlannedCover(coverPlan),
      });
    return await withReadableErrors(() =>
      atomicOn(conn, (d) => [
        ...snapshotGuardQueries(d, plan.snapshot),
        ...prepared.queries(d),
      ]),
    );
  } catch (error) {
    if (coverPlan) await discardUnusedCover(conn, coverPlan).catch(() => {});
    throw error;
  }
}
