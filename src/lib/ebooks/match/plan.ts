import { randomUUID } from "node:crypto";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { databaseFingerprint } from "../ingest/command";
import {
  dataFingerprint,
  loadMatchCatalogue,
  type LoadedMatchCatalogue,
} from "./load";
import { matchInMemory } from "./tiers";
import { MATCH_MODEL } from "./model";
import type { MatchOperationIdentity, MatchResult } from "./types";
import type { Db } from "@/lib/catalogue/work-store";
import { verifyReviewCompensationOn, parseReviewCompensation, type ReviewCompensation } from "./review-extension";

export type MatchingMode = "ingestion" | "classification_only";
export interface ClassificationPlan extends MatchOperationIdentity {
  kind: "classification";
  mode: MatchingMode;
  createdAt: string;
  modelFingerprint: string;
  snapshot: Pick<
    LoadedMatchCatalogue,
    "rows" | "catalogueFingerprint" | "inputFingerprint"
  >;
  results: readonly MatchResult[];
  restoreIds: readonly string[];
  reviewCompensation?: ReviewCompensation;
}
export function hashMatchingPlan(plan: object): string {
  const payload = { ...plan } as Record<string, unknown>;
  delete payload.planSha256;
  return dataFingerprint(payload);
}
export function validateMatchingPlan(
  plan: ClassificationPlan,
  runtimeTarget: string,
): void {
  if (
    plan.kind !== "classification" ||
    plan.version !== 1 ||
    plan.targetDatabase !== runtimeTarget ||
    plan.modelFingerprint !== dataFingerprint(MATCH_MODEL) ||
    plan.planSha256 !== hashMatchingPlan(plan)
  )
    throw new Error(
      "Matching plan identity, target, model or hash changed; nothing written",
    );
  if (!["ingestion", "classification_only"].includes(plan.mode))
    throw new Error("Unknown matching mode");
  if (plan.restoreIds.length && plan.mode !== "classification_only")
    throw new Error("Restoring decisions requires classification-only mode");
}
/** Restore explicitly scores a pending view even when the bibliographic
 * fingerprint did not change; the real decision row stays in stale guards. */
export function classifyLoaded(
  snapshot: LoadedMatchCatalogue,
  ids: readonly string[] | "all",
  options: {
    mode?: MatchingMode;
    restoreIds?: readonly string[];
    rematch?: boolean;
  } = {},
): MatchResult[] {
  const restored = new Set(options.restoreIds ?? []);
  if (restored.size && options.mode !== "classification_only")
    throw new Error("Restore needs classification-only mode");
  const requested = ids === "all" ? null : new Set(ids);
  const ebooks = snapshot.catalogue.source.ebooks.filter(
    (ebook) => !requested || requested.has(ebook.id),
  );
  if (requested && ebooks.length !== requested.size)
    throw new Error("A requested ebook is missing");
  if (
    [...restored].some(
      (id) =>
        !ebooks.some(
          (ebook) =>
            ebook.id === id &&
            !ebook.instanceId &&
            ["standalone", "excluded"].includes(ebook.matchState),
        ),
    )
  )
    throw new Error(
      "Restore requires an existing unlinked Keep or Set aside decision",
    );
  return matchInMemory(
    ebooks.map((ebook) =>
      restored.has(ebook.id)
        ? { ...ebook, matchState: "pending", exclusionReason: null }
        : ebook,
    ),
    snapshot.catalogue,
    { rematch: options.rematch },
  );
}
/** This API plans classification only. Ingestion later consumes its eligible
 * effects through the separately guarded shared link writer. It never writes. */
export async function planMatching(
  url: string,
  ids: readonly string[] | "all",
  options: {
    mode?: MatchingMode;
    restoreIds?: readonly string[];
    rematch?: boolean;
    runId?: string;
    now?: string;
  } = {},
): Promise<ClassificationPlan> {
  return withReadOnlyPlanningConnection(
    url,
    (conn) =>
      planMatchingOn(conn, ids, {
        ...options,
        targetDatabase: databaseFingerprint(url),
      }),
    { isolationLevel: "repeatable read" },
  );
}
export async function planMatchingOn(
  conn: Db,
  ids: readonly string[] | "all",
  options: {
    targetDatabase: string;
    mode?: MatchingMode;
    restoreIds?: readonly string[];
    rematch?: boolean;
    runId?: string;
    now?: string;
    reviewCompensation?: ReviewCompensation;
  },
): Promise<ClassificationPlan> {
  const snapshot = await loadMatchCatalogue(conn);
  let reviewCompensation: ReviewCompensation | undefined;
  if (options.reviewCompensation !== undefined) {
    const policy = parseReviewCompensation(options.reviewCompensation);
    if (ids === "all" || ids.length !== 1 || options.mode !== "classification_only" ||
        options.restoreIds?.length !== 1 || options.restoreIds[0] !== ids[0] ||
        policy.originalOperation.targetDatabase !== options.targetDatabase ||
        (options.runId && options.runId !== policy.originalOperation.runId))
      throw new Error("Review compensation requires one target and its classification-only restoration");
    reviewCompensation = await verifyReviewCompensationOn(
      conn, policy, ids[0], ["keep", "exclude"], snapshot,
    );
  }
  const plan: ClassificationPlan = {
    version: 1,
    operationId: randomUUID(),
    runId: options.runId ?? reviewCompensation?.originalOperation.runId ?? randomUUID(),
    planSha256: "",
    targetDatabase: options.targetDatabase,
    kind: "classification",
    mode: options.mode ?? "ingestion",
    createdAt: options.now ?? new Date().toISOString(),
    modelFingerprint: dataFingerprint(MATCH_MODEL),
    snapshot: {
      rows: snapshot.rows,
      catalogueFingerprint: snapshot.catalogueFingerprint,
      inputFingerprint: snapshot.inputFingerprint,
    },
    results: classifyLoaded(snapshot, ids, options),
    restoreIds: [...(options.restoreIds ?? [])].sort(),
    ...(reviewCompensation ? { reviewCompensation } : {}),
  };
  plan.planSha256 = hashMatchingPlan(plan);
  return plan;
}
