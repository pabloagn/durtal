import { immutableMatchingWriterInput } from "./writer-input";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { ebooks, ebookMatchCandidates } from "@/lib/db/schema";
import { atomicOn } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { databaseFingerprint } from "../ingest/command";
import {
  loadMatchCatalogue,
  dataFingerprint,
  type LoadedMatchCatalogue,
} from "./load";
import { hashMatchingPlan } from "./plan";
import { matchFingerprint } from "./keys";
import { snapshotGuardQueries } from "./guards";
import { MATCH_MODEL } from "./model";
import type { MatchOperationIdentity } from "./types";
import { requireCoreAtomicExtension, uploadTimestamp, type PreparedCoreAtomicExtension } from "./atomic-extension";

export type EbookDecision =
  | { action: "keep" }
  | { action: "set_aside"; reason: "duplicate" | "not_a_book" | "other" };
export interface DecisionPlan extends MatchOperationIdentity {
  kind: "decision";
  mode: "classification_only";
  createdAt: string;
  modelFingerprint: string;
  snapshot: Pick<
    LoadedMatchCatalogue,
    "rows" | "catalogueFingerprint" | "inputFingerprint"
  >;
  decision: EbookDecision;
  ebooks: readonly { id: string; fingerprint: string }[];
}
export async function planDecisionOn(
  conn: Db,
  ids: readonly string[],
  decision: EbookDecision,
  identity: { runId: string; targetDatabase: string; now?: string },
): Promise<DecisionPlan> {
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    !["keep", "set_aside"].includes(decision.action) ||
    (decision.action === "set_aside" &&
      !["duplicate", "not_a_book", "other"].includes(decision.reason))
  )
    throw new Error("Choose distinct ebooks and a valid decision");
  const loaded = await loadMatchCatalogue(conn);
  const selected = loaded.catalogue.source.ebooks.filter((ebook) =>
    ids.includes(ebook.id),
  );
  if (
    selected.length !== ids.length ||
    selected.some((ebook) => ebook.instanceId || ebook.matchState === "linked")
  )
    throw new Error("Keep and Set aside require existing unlinked ebooks");
  const plan: DecisionPlan = {
    version: 1,
    operationId: randomUUID(),
    runId: identity.runId,
    planSha256: "",
    targetDatabase: identity.targetDatabase,
    kind: "decision",
    mode: "classification_only",
    createdAt: identity.now ?? new Date().toISOString(),
    modelFingerprint: dataFingerprint(MATCH_MODEL),
    snapshot: {
      rows: loaded.rows,
      catalogueFingerprint: loaded.catalogueFingerprint,
      inputFingerprint: loaded.inputFingerprint,
    },
    decision,
    ebooks: selected.map((ebook) => ({
      id: ebook.id,
      fingerprint: matchFingerprint(ebook),
    })),
  };
  plan.planSha256 = hashMatchingPlan(plan);
  return plan;
}
export async function planDecision(
  url: string,
  ids: readonly string[],
  decision: EbookDecision,
) {
  return withReadOnlyPlanningConnection(
    url,
    (conn) =>
      planDecisionOn(conn, ids, decision, {
        runId: randomUUID(),
        targetDatabase: databaseFingerprint(url),
      }),
    { isolationLevel: "repeatable read" },
  );
}
export async function applyDecision(
  conn: Db,
  plan: DecisionPlan,
  target: string,
  options: { atomicExtension?: PreparedCoreAtomicExtension } = {},
) {
  plan = immutableMatchingWriterInput(plan);
  if (
    plan.kind !== "decision" ||
    plan.mode !== "classification_only" ||
    plan.version !== 1 ||
    plan.targetDatabase !== target ||
    plan.modelFingerprint !== dataFingerprint(MATCH_MODEL) ||
    plan.planSha256 !== hashMatchingPlan(plan) ||
    !plan.ebooks.length ||
    new Set(plan.ebooks.map((ebook) => ebook.id)).size !== plan.ebooks.length ||
    !["keep", "set_aside"].includes(plan.decision.action) ||
    (plan.decision.action === "set_aside" &&
      !["duplicate", "not_a_book", "other"].includes(plan.decision.reason))
  )
    throw new Error("Decision mode, model, target or hash changed");
  const extension = requireCoreAtomicExtension(options.atomicExtension, {
    coreWriter: "decision", coreOperation: plan, ebookIds: plan.ebooks.map((ebook) => ebook.id),
  });
  const at = new Date(plan.createdAt);
  if (!Number.isFinite(at.getTime()))
    throw new Error("Invalid decision timestamp");
  return withReadableErrors(() =>
    atomicOn(conn, (d) => [
      ...snapshotGuardQueries(d, plan.snapshot, extension?.extraTables),
      ...(extension?.before(d) ?? []),
      d.delete(ebookMatchCandidates).where(
        inArray(
          ebookMatchCandidates.ebookId,
          plan.ebooks.map((ebook) => ebook.id),
        ),
      ),
      ...plan.ebooks.map((ebook) =>
        d
          .update(ebooks)
          .set({
            matchState:
              plan.decision.action === "keep" ? "standalone" : "excluded",
            exclusionReason:
              plan.decision.action === "set_aside"
                ? plan.decision.reason
                : null,
            matchTier: null,
            duplicateOfId: null,
            matchFingerprint: ebook.fingerprint,
            matchModelVersion: MATCH_MODEL.version,
            updatedAt: uploadTimestamp(extension, at),
          })
          .where(eq(ebooks.id, ebook.id)),
      ),
      ...(extension?.after(d) ?? []),
    ]),
  );
}
