import type { Db } from "@/lib/catalogue/work-store";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { loadMatchCatalogue } from "../match/load";
import { editionEffect } from "../match/editions";
import { MATCH_MODEL } from "../match/model";
import { selectedCandidateHash } from "./candidate-hash";
import { readReviewBeforeOn } from "./store";
import { ReviewError } from "./errors";
/** Private projection; the actual loader supplies publication/file capability
 * and complete catalogue identity evidence, never a format-only approximation. */
export async function loadEbookReview(conn: Db, ebookId: string) {
  const before = await readReviewBeforeOn(conn, ebookId);
  if (!before) throw new ReviewError("ebook_not_found", "eBook not found.");
  const loaded = await loadMatchCatalogue(conn);
  const ebook = loaded.catalogue.source.ebooks.find((row) => row.id === before.ebookId);
  if (!ebook) throw new ReviewError("ebook_not_found", "eBook not found.");
  const candidates = loaded.rows.ebook_match_candidates.filter((row) => row.ebook_id === ebook.id)
    .flatMap((row) => {
      const work = loaded.catalogue.byWorkId.get(String(row.work_id));
      const text = before.candidateSnapshotTexts.find((value) => JSON.parse(value).id === row.id);
      if (!work || !text) return [];
      const effect = editionEffect(ebook, work, loaded.catalogue);
      const rank = Number(row.rank), modelVersion = Number(row.model_version);
      const eligible = before.snapshot.matchState === "pending" && modelVersion === MATCH_MODEL.version && effect.ready &&
        row.edition_rule === effect.rule && (row.edition_id ?? null) === effect.editionId &&
        (row.instance_id ?? null) === (effect.movedFromEditionId ? null : effect.instanceId);
      return [{
        rank, workId: work.source.id, title: work.source.title,
        probability: Number(row.probability), eligible, effectText: effect.text,
        candidateHash: selectedCandidateHash(text, rank, before.snapshot.matchFingerprint, modelVersion, effect),
      }];
    });
  return {
    id: ebook.id, title: ebook.title, authors: ebook.authors,
    state: before.snapshot.matchState,
    stamp: { updatedAt: before.snapshot.updatedAt, matchFingerprint: before.snapshot.matchFingerprint },
    candidates: candidates.sort((a, b) => a.rank - b.rank),
    files: ebook.files.map((file) => ({ id: file.id, format: file.format,
      sizeBytes: file.sizeBytes, availability: file.availability })),
  };
}
export async function getEbookReview(url: string, ebookId: string) {
  return withReadOnlyPlanningConnection(url, (conn) => loadEbookReview(conn, ebookId),
    { isolationLevel: "repeatable read" });
}
