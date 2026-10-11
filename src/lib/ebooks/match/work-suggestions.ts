import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { parseId } from "@/lib/validations/helpers";
import { atomicOn } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { resultRows } from "@/lib/harmonization/store";
import { dataFingerprint, loadMatchCatalogue } from "./load";
import { immutableMatchingWriterInput } from "./link";
import { classificationQueries } from "./classification";
import { snapshotGuardQueries } from "./guards";
import { classifyLoaded, hashMatchingPlan, validateMatchingPlan, type ClassificationPlan } from "./plan";
import { MATCH_MODEL } from "./model";
import { requireFiniteScore, requireMatchProbability } from "./validation";

export const WORK_SUGGESTION_BOUNDS = Object.freeze({
  maxRowsPerTable: 4096, maxSnapshotBytes: 16 * 1024 * 1024, maxPendingEbooks: 64,
});
export interface WorkSuggestionPlan extends ClassificationPlan {
  workId: string;
  bounds: typeof WORK_SUGGESTION_BOUNDS;
  scopeEbookIds: readonly string[];
}
export type WorkSuggestionOutcome = {
  workId: string; suggestionCount: number; status: "ready" | "unavailable";
};
/** Plan the actual model against a bounded complete catalogue. Retain complete
 * candidate lists for relevant eBooks so probabilities/ranks remain calibrated
 * against competing works. This boundary has no link or accession branch. */
export async function planSuggestionsForWorkOn(conn: Db, workId: string,
  identity: { targetDatabase: string; runId?: string; now?: string }): Promise<WorkSuggestionPlan> {
  workId = parseId(workId);
  identity = immutableMatchingWriterInput(identity);
  const snapshot = await loadMatchCatalogue(conn, WORK_SUGGESTION_BOUNDS);
  if (!snapshot.rows.works.some((row) => row.id === workId && row.kind === "book"))
    throw new Error("Post-create suggestions require the actual existing book");
  const pending = snapshot.catalogue.source.ebooks.filter((ebook) =>
    !ebook.instanceId && ebook.matchState === "pending").map((ebook) => ebook.id).sort();
  if (pending.length > WORK_SUGGESTION_BOUNDS.maxPendingEbooks)
    throw new Error("Post-create suggestions exceed the pending eBook bound");
  const oldCandidates = new Set(snapshot.rows.ebook_match_candidates.filter((row) =>
    row.work_id === workId).map((row) => String(row.ebook_id)));
  const results = classifyLoaded(snapshot, pending, { mode: "classification_only", rematch: true })
    .filter((result) => !result.skipped && (oldCandidates.has(result.ebookId) ||
      result.candidates.some((candidate) => candidate.workId === workId)))
    .map((result) => ({ ...result, autoLink: false }));
  const plan: WorkSuggestionPlan = {
    version: 1, operationId: randomUUID(), runId: identity.runId ?? randomUUID(), planSha256: "",
    targetDatabase: identity.targetDatabase, kind: "classification", mode: "classification_only",
    createdAt: identity.now ?? new Date().toISOString(), modelFingerprint: dataFingerprint(MATCH_MODEL),
    snapshot: { rows: snapshot.rows, catalogueFingerprint: snapshot.catalogueFingerprint,
      inputFingerprint: snapshot.inputFingerprint }, results, restoreIds: [], workId,
    scopeEbookIds: pending, bounds: WORK_SUGGESTION_BOUNDS,
  };
  plan.planSha256 = hashMatchingPlan(plan);
  return immutableMatchingWriterInput(plan);
}
export async function persistWorkSuggestions(conn: Db, plan: WorkSuggestionPlan,
  runtimeTarget: string): Promise<WorkSuggestionOutcome & { status: "ready" }> {
  plan = immutableMatchingWriterInput(plan);
  parseId(plan.workId);
  validateMatchingPlan(plan, runtimeTarget);
  const pending = plan.snapshot.rows.ebooks.filter((row) =>
    row.instance_id == null && row.match_state === "pending").map((row) => String(row.id)).sort();
  if (plan.mode !== "classification_only" || plan.restoreIds.length || plan.reviewCompensation ||
      dataFingerprint(plan.bounds) !== dataFingerprint(WORK_SUGGESTION_BOUNDS) ||
      pending.length > WORK_SUGGESTION_BOUNDS.maxPendingEbooks ||
      dataFingerprint(pending) !== dataFingerprint(plan.scopeEbookIds) ||
      !plan.snapshot.rows.works.some((row) => row.id === plan.workId && row.kind === "book") ||
      Object.values(plan.snapshot.rows).some((rows) => rows.length > WORK_SUGGESTION_BOUNDS.maxRowsPerTable) ||
      Buffer.byteLength(JSON.stringify(plan.snapshot.rows), "utf8") > WORK_SUGGESTION_BOUNDS.maxSnapshotBytes ||
      new Set(plan.results.map((result) => result.ebookId)).size !== plan.results.length ||
      plan.results.some((result) => !pending.includes(result.ebookId) || result.skipped || result.autoLink ||
        result.modelVersion !== MATCH_MODEL.version ||
        (!result.candidates.some((candidate) => candidate.workId === plan.workId) &&
         !plan.snapshot.rows.ebook_match_candidates.some((row) => row.ebook_id === result.ebookId && row.work_id === plan.workId))))
    throw new Error("Post-create suggestion plan scope changed; nothing written");
  const at = new Date(plan.createdAt);
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid suggestion timestamp");
  for (const result of plan.results) for (const candidate of result.candidates) {
    requireMatchProbability(candidate.probability);
    requireFiniteScore(candidate.weightBits, candidate.marginBits);
  }
  const results = await withReadableErrors(() => atomicOn(conn, (d) => [
    ...snapshotGuardQueries(d, plan.snapshot),
    ...classificationQueries(d, plan.results, at),
    d.execute(sql`select ${plan.workId}::text "workId", count(*)::int "suggestionCount",
      'ready'::text status from ebook_match_candidates c join ebooks e on e.id=c.ebook_id
      where c.work_id=${plan.workId}::uuid and c.model_version=${MATCH_MODEL.version}
        and e.match_state='pending' and e.instance_id is null`),
  ]));
  const [row] = resultRows<WorkSuggestionOutcome>(results[results.length - 1]);
  if (!row || row.workId !== plan.workId || row.status !== "ready" ||
      !Number.isSafeInteger(row.suggestionCount) || row.suggestionCount < 0)
    throw new Error("The committed suggestion count is unavailable");
  return { workId: row.workId, suggestionCount: row.suggestionCount, status: "ready" };
}
