import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/catalogue/work-store";
import { atomicOn } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { databaseFingerprint } from "../ingest/command";
import {
  loadMatchCatalogue,
  dataFingerprint,
  type LoadedMatchCatalogue,
} from "./load";
import {
  groupEvidence,
  requireApprovedGroupPlan,
  type ApprovedGroupMatching,
  type RegisteredMatchGroup,
} from "./groups";
import { MATCH_MODEL } from "./model";
import { hashMatchingPlan } from "./plan";
import { matchFingerprint } from "./keys";
import { editionEffect } from "./editions";
import {
  classificationQueries,
  classificationIsCurrent,
} from "./classification";
import { snapshotGuardQueries } from "./guards";
import { prepareLinkWrite, type LinkPlan, type LinkReceipt } from "./link";
import type { MatchOperationIdentity, MatchResult } from "./types";
import { planCoverCopy, copyPlannedCover, discardUnusedCover } from "./covers";

export interface GroupApplyPlan extends MatchOperationIdentity {
  kind: "apply_groups";
  mode: "ingestion";
  createdAt: string;
  modelFingerprint: string;
  approval: ApprovedGroupMatching;
  snapshot: Pick<
    LoadedMatchCatalogue,
    "rows" | "catalogueFingerprint" | "inputFingerprint"
  >;
  links: readonly LinkPlan[];
  classifications: readonly MatchResult[];
}
export type GroupApplyPlanning =
  | { kind: "unchanged"; linked: number; preserved: number }
  | { kind: "planned"; plan: GroupApplyPlan };
export { requireApprovedGroupPlan } from "./groups";
/** Registration map is proven against actual file ownership/checksums. The
 * frozen effects are compared, never replaced with a freshly scored route. */
export async function planApprovedGroupsOn(
  conn: Db,
  approval: ApprovedGroupMatching,
  registered: readonly RegisteredMatchGroup[],
  identity: { runId: string; targetDatabase: string; now?: string },
): Promise<GroupApplyPlanning> {
  const approved = approval.plan,
    approvedHash = dataFingerprint(approved);
  requireApprovedGroupPlan(approval);
  if (
    registered.length !== approved.groups.length ||
    new Set(registered.map((group) => group.groupKey)).size !==
      registered.length ||
    new Set(registered.map((group) => group.ebookId)).size !== registered.length
  )
    throw new Error("Registration map is incomplete or duplicates an ebook");
  const loaded = await loadMatchCatalogue(conn),
    byKey = new Map(registered.map((group) => [group.groupKey, group]));
  const remap = new Map(
    approved.groups.map((group) => [
      group.result.ebookId,
      byKey.get(group.groupKey)?.ebookId,
    ]),
  );
  const links: LinkPlan[] = [],
    classifications: MatchResult[] = [];
  let completed = 0,
    preserved = 0;
  for (const group of approved.groups) {
    const mapped = byKey.get(group.groupKey);
    const ebook =
      mapped &&
      loaded.catalogue.source.ebooks.find(
        (ebook) => ebook.id === mapped.ebookId,
      );
    if (
      !mapped ||
      !ebook ||
      (group.existingEbookId && group.existingEbookId !== ebook.id) ||
      matchFingerprint(ebook) !== group.metadataFingerprint ||
      dataFingerprint(groupEvidence(ebook)) !== group.evidenceFingerprint
    )
      throw new Error(
        `Registered metadata or delivery evidence changed for ${group.groupKey}`,
      );
    if (
      Object.keys(mapped.fileIds).length !== group.fileHashes.length ||
      group.fileHashes.some(
        (file) =>
          !ebook.files.some(
            (actual) =>
              actual.sha256 === file.sha256 &&
              actual.format === file.format &&
              actual.id === mapped.fileIds[file.sha256],
          ),
      )
    )
      throw new Error(`Registered file map differs for ${group.groupKey}`);
    const raw = loaded.rows.ebooks.find((row) => row.id === ebook.id)!;
    const receipt = raw.link_written as LinkReceipt | null;
    if (
      ebook.matchState === "linked" &&
      receipt?.approvedGroupHash === approvedHash &&
      receipt.runId === identity.runId &&
      receipt.targetDatabase === identity.targetDatabase &&
      receipt.instanceId === ebook.instanceId &&
      receipt.ebookId === ebook.id
    ) {
      completed++;
      continue;
    }
    if (
      dataFingerprint({
        instanceId: ebook.instanceId,
        matchState: ebook.matchState,
        matchFingerprint:
          ebook.matchState === "pending"
            ? group.decision.matchFingerprint
            : ebook.matchFingerprint,
        exclusionReason: ebook.exclusionReason ?? null,
      }) !== dataFingerprint(group.decision)
    )
      throw new Error(`An owner decision changed for ${group.groupKey}`);
    if (group.result.skipped) {
      preserved++;
      continue;
    }
    const result = {
      ...group.result,
      ebookId: ebook.id,
      duplicateOfId: group.result.duplicateOfId
        ? (remap.get(group.result.duplicateOfId) ?? group.result.duplicateOfId)
        : null,
    };
    if (!result.autoLink) {
      if (classificationIsCurrent(loaded, result)) preserved++;
      else classifications.push(result);
      continue;
    }
    const candidate = result.candidates[0],
      work = loaded.catalogue.byWorkId.get(candidate.workId);
    if (
      !work ||
      dataFingerprint(editionEffect(ebook, work, loaded.catalogue)) !==
        dataFingerprint(candidate.effect)
    )
      throw new Error(`Approved edition or copy changed for ${group.groupKey}`);
    const effect = candidate.effect;
    if (
      effect.instanceId &&
      links.some((plan) => plan.effect.instanceId === effect.instanceId)
    )
      throw new Error(
        "Several approved links compete for one copy; review the groups",
      );
    const receiptRows = {
      ...Object.fromEntries(
        Object.keys(loaded.rows).map((table) => [table, []]),
      ),
      ebooks: [raw],
      instances: loaded.rows.instances.filter(
        (row) => row.id === effect.instanceId,
      ),
      ebook_match_candidates: loaded.rows.ebook_match_candidates.filter(
        (row) => row.ebook_id === ebook.id,
      ),
      ebook_files: loaded.rows.ebook_files.filter(
        (row) => row.ebook_id === ebook.id,
      ),
    } as unknown as LoadedMatchCatalogue["rows"];
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
        rows: receiptRows,
        catalogueFingerprint: loaded.catalogueFingerprint,
        inputFingerprint: loaded.inputFingerprint,
      },
      ebook,
      effect,
      choices: {
        ebookId: ebook.id,
        workId: candidate.workId,
        method: candidate.identifierMethods[0] ?? "score",
        probability: candidate.probability,
      },
      editionId: effect.editionId ?? randomUUID(),
      instanceId: effect.instanceId ?? randomUUID(),
      instanceHistoryId: effect.instanceId ? null : randomUUID(),
      activityId: effect.newCopy ? randomUUID() : null,
      editionActivityId: effect.newEdition ? randomUUID() : null,
      approvedGroupHash: approvedHash,
    };
    plan.planSha256 = hashMatchingPlan(plan);
    links.push(plan);
  }
  if (completed && (links.length || classifications.length))
    throw new Error(
      "Only part of the matching operation remains; review changed links rather than replaying effects",
    );
  if (
    !completed &&
    loaded.catalogueFingerprint !== approved.binding.catalogueFingerprint
  )
    throw new Error(
      "Catalogue changed since matching approval; nothing matched",
    );
  if (!links.length && !classifications.length)
    return { kind: "unchanged", linked: completed, preserved };
  const plan: GroupApplyPlan = {
    version: 1,
    operationId: randomUUID(),
    runId: identity.runId,
    planSha256: "",
    targetDatabase: identity.targetDatabase,
    kind: "apply_groups",
    mode: "ingestion",
    createdAt: identity.now ?? new Date().toISOString(),
    modelFingerprint: dataFingerprint(MATCH_MODEL),
    approval,
    snapshot: {
      rows: loaded.rows,
      catalogueFingerprint: loaded.catalogueFingerprint,
      inputFingerprint: loaded.inputFingerprint,
    },
    links,
    classifications,
  };
  plan.planSha256 = hashMatchingPlan(plan);
  return { kind: "planned", plan };
}
export async function planApprovedGroups(
  url: string,
  approval: ApprovedGroupMatching,
  registered: readonly RegisteredMatchGroup[],
  runId: string,
) {
  return withReadOnlyPlanningConnection(
    url,
    (conn) =>
      planApprovedGroupsOn(conn, approval, registered, {
        runId,
        targetDatabase: databaseFingerprint(url),
      }),
    { isolationLevel: "repeatable read" },
  );
}
/** One atomic after all groups are registered makes cross-process/resume
 * protection explicit. No earlier own link can invalidate a later effect. */
export async function applyApprovedGroups(
  conn: Db,
  plan: GroupApplyPlan,
  target: string,
  options: { beforeWrite?: (receipt: LinkReceipt) => Promise<void> } = {},
) {
  if (
    plan.kind !== "apply_groups" ||
    plan.mode !== "ingestion" ||
    plan.version !== 1 ||
    plan.targetDatabase !== target ||
    plan.planSha256 !== hashMatchingPlan(plan) ||
    plan.modelFingerprint !== dataFingerprint(MATCH_MODEL)
  )
    throw new Error("Matching apply identity, target, model or hash changed");
  requireApprovedGroupPlan(plan.approval);
  const at = new Date(plan.createdAt);
  if (!Number.isFinite(at.getTime()))
    throw new Error("Invalid matching apply timestamp");
  const coverPlans = plan.links.map((link) =>
    planCoverCopy(
      link.snapshot,
      link.ebook.id,
      link.editionId,
      link.effect.newEdition?.coverSourceKey ?? null,
    ),
  );
  const prepared = await Promise.all(
    plan.links.map((link, i) =>
      prepareLinkWrite(link, target, {
        automaticApproval: plan.approval,
        preparedCover: coverPlans[i]
          ? { ...coverPlans[i], palette: null }
          : null,
      }),
    ),
  );
  for (const item of prepared) await options.beforeWrite?.(item.receipt);
  try {
    for (const [i, coverPlan] of coverPlans.entries())
      if (coverPlan)
        prepared[i] = await prepareLinkWrite(plan.links[i], target, {
          automaticApproval: plan.approval,
          preparedCover: await copyPlannedCover(coverPlan),
        });
    const result = await withReadableErrors(() =>
      atomicOn(conn, (d) => [
        ...snapshotGuardQueries(d, plan.snapshot),
        // Derived review state alone is not an owner edit. Keep registration's
        // timestamp so ingestion undo can still remove its untouched pending
        // ebook; candidate creation timestamps record this computation.
        ...classificationQueries(d, plan.classifications, at, { touchEbook: false }),
        ...prepared.flatMap((item) => item.queries(d)),
      ]),
    );
    return {
      result,
      linked: prepared.length,
      classified: plan.classifications.length,
      receipts: prepared.map((item) => item.receipt),
    };
  } catch (error) {
    for (const coverPlan of coverPlans)
      if (coverPlan) await discardUnusedCover(conn, coverPlan).catch(() => {});
    throw error;
  }
}
