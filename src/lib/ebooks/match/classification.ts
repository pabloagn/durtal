import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { atomicOn } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { ebookMatchCandidates, ebooks } from "@/lib/db/schema";
import { snapshotGuardQueries } from "./guards";
import { validateMatchingPlan, type ClassificationPlan } from "./plan";
import { requireFiniteScore, requireMatchProbability } from "./validation";
import type { MatchResult } from "./types";
import { dataFingerprint, type LoadedMatchCatalogue } from "./load";

export function classificationIsCurrent(
  snapshot: Pick<LoadedMatchCatalogue, "rows">,
  result: MatchResult,
) {
  const row = snapshot.rows.ebooks.find((row) => row.id === result.ebookId);
  if (
    !row ||
    row.match_state !== "pending" ||
    row.match_tier !== result.tier ||
    row.match_fingerprint !== result.fingerprint ||
    row.match_model_version !== result.modelVersion ||
    (row.duplicate_of_id ?? null) !== result.duplicateOfId
  )
    return false;
  const stored = snapshot.rows.ebook_match_candidates.filter(
    (row) => row.ebook_id === result.ebookId,
  );
  if (stored.length !== result.candidates.length) return false;
  return result.candidates.every((candidate) => {
    const row = stored.find((row) => row.rank === candidate.rank);
    return (
      !!row &&
      row.work_id === candidate.workId &&
      (row.edition_id ?? null) === candidate.effect.editionId &&
      (row.instance_id ?? null) ===
        (candidate.effect.movedFromEditionId
          ? null
          : candidate.effect.instanceId) &&
      row.edition_rule === candidate.effect.rule &&
      row.model_version === result.modelVersion &&
      Math.abs(Number(row.probability) - candidate.probability) < 1e-6 &&
      Math.abs(Number(row.weight_bits) - candidate.weightBits) < 1e-4 &&
      (candidate.marginBits === null
        ? row.margin_bits == null
        : row.margin_bits != null &&
          Math.abs(Number(row.margin_bits) - candidate.marginBits) < 1e-4) &&
      dataFingerprint(row.reasons) ===
        dataFingerprint([
          ...candidate.reasons,
          ...candidate.effect.ambiguities,
          ...(candidate.effect.movedFromEditionId
            ? [{ code: "move_copy", text: candidate.effect.text }]
            : []),
        ]) &&
      dataFingerprint(row.flags) === dataFingerprint(candidate.flags)
    );
  });
}

export function classificationQueries(
  d: Db,
  results: readonly MatchResult[],
  at: Date,
  options: { touchEbook?: boolean } = {},
) {
  return results
    .filter((result) => !result.skipped)
    .flatMap((result) => [
      d
        .delete(ebookMatchCandidates)
        .where(eq(ebookMatchCandidates.ebookId, result.ebookId)),
      d
        .update(ebooks)
        .set({
          matchTier: result.tier,
          matchFingerprint: result.fingerprint,
          matchModelVersion: result.modelVersion,
          duplicateOfId: result.duplicateOfId,
          ...(options.touchEbook === false ? {} : { updatedAt: at }),
        })
        .where(eq(ebooks.id, result.ebookId)),
      ...(result.candidates.length
        ? [
            d.insert(ebookMatchCandidates).values(
              result.candidates.map((candidate) => {
                requireMatchProbability(candidate.probability);
                requireFiniteScore(candidate.weightBits, candidate.marginBits);
                return {
                  id: randomUUID(),
                  ebookId: result.ebookId,
                  rank: candidate.rank,
                  workId: candidate.workId,
                  editionId: candidate.effect.editionId,
                  instanceId: candidate.effect.movedFromEditionId
                    ? null
                    : candidate.effect.instanceId,
                  editionRule: candidate.effect.rule,
                  probability: candidate.probability,
                  weightBits: candidate.weightBits,
                  marginBits: candidate.marginBits,
                  reasons: [
                    ...candidate.reasons,
                    ...candidate.effect.ambiguities,
                    ...(candidate.effect.movedFromEditionId
                      ? [{ code: "move_copy", text: candidate.effect.text }]
                      : []),
                  ],
                  flags: [...candidate.flags],
                  modelVersion: result.modelVersion,
                  createdAt: at,
                };
              }),
            ),
          ]
        : []),
    ]);
}

/** Classification persistence has no link or accession branch. The hashed
 * classification-only mode therefore cannot accidentally consume autoLink. */
export async function persistClassification(
  conn: Db,
  plan: ClassificationPlan,
  runtimeTarget: string,
): Promise<void> {
  validateMatchingPlan(plan, runtimeTarget);
  const restored = new Set(plan.restoreIds);
  const at = new Date(plan.createdAt);
  if (!Number.isFinite(at.getTime()))
    throw new Error("Invalid classification timestamp");
  for (const result of plan.results)
    for (const candidate of result.candidates) {
      requireMatchProbability(candidate.probability);
      requireFiniteScore(candidate.weightBits, candidate.marginBits);
    }
  await withReadableErrors(() =>
    atomicOn(conn, (d) => [
      ...snapshotGuardQueries(d, plan.snapshot),
      ...plan.results
        .filter((result) => !result.skipped)
        .flatMap((result) => [
          d
            .update(ebooks)
            .set({
              ...(restored.has(result.ebookId) ||
              plan.snapshot.rows.ebooks.find((row) => row.id === result.ebookId)
                ?.match_state !== "pending"
                ? { matchState: "pending" as const, exclusionReason: null }
                : {}),
              updatedAt: at,
            })
            .where(eq(ebooks.id, result.ebookId)),
        ]),
      ...classificationQueries(d, plan.results, at),
    ]),
  );
}
