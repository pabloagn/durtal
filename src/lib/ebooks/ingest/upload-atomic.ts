import "server-only";
import { uploadRegistrationTargetSchema, type UploadRegistrationTarget } from "../upload/registration-target";
export type { UploadRegistrationTarget } from "../upload/registration-target";
import { z } from "zod/v4";
import type { Db } from "@/lib/catalogue/work-store";
import { immutableMatchingWriterInput } from "../match/writer-input";
import { loadMatchCatalogue, matchFileFromStoredRow } from "../match/load";
import { scoreNewGroups } from "../match/calibration";
import type { MatchEbook, MatchOperationIdentity } from "../match/types";
import { reviewPayloadHash, canonicalReviewJson } from "../review/receipts";
import { acceptedPublication } from "../publication-evidence";
import { readUploadTargetSnapshotOn } from "../upload/atomic-snapshots";
import { UploadError } from "../upload/protocol";
import type { UploadAtomicBinding, PreparedUploadAtomicExtension } from "../upload/atomic-extension";
import { privateRegistrationInput } from "./registration-input";
import { readGroupCatalogue, planRegistration, registerGroup, registrationPlanSha256,
  planRegistrationRestoration, restoreRegisteredFileOn, compensateRegistrationOn,
  type CatalogueFileRow, type GroupCatalogue, type Registration, type RegistrationRestorationPlan,
  type UploadRegistrationClassification } from "./register";
import type { PlanFile, PlanGroup } from "./plan";

export { prepareUploadAtomicExtension } from "../upload/atomic-extension";
export function uploadTargetRowsFingerprint(snapshot: Pick<UploadAtomicBinding["targetSnapshot"], "ebooks" | "ebook_files">): string {
  return reviewPayloadHash({ version: 1, ebooks: snapshot.ebooks, ebook_files: snapshot.ebook_files });
}
function catalogueFile(row: Record<string, unknown>): CatalogueFileRow {
  return { id: z.uuid().parse(row.id), ebookId: z.uuid().parse(row.ebook_id), sha256: z.string().parse(row.sha256),
    format: z.string().parse(row.format), status: z.string().parse(row.status), drm: z.string().nullable().parse(row.drm),
    coverKey: z.string().nullable().parse(row.cover_key), metadata: z.record(z.string(), z.unknown()).parse(row.metadata),
    // These Dates are sorting inputs only. Exact UTC6 full rows remain in the
    // capability and atomic guards; no timestamp guard is made from a Date.
    createdAt: new Date(z.string().parse(row.created_at)) };
}
/** Caller supplies actual inspected/published native494 PlanFile under its
 * read-only protected planning connection. Explicit add/replace target IDs are
 * resolved here rather than inferred from import_ref or checksum. */
export async function planUploadRegistrationOn(conn: Db, input: {
  group: PlanGroup; file: PlanFile; target: UploadRegistrationTarget; runId: string; at: Date;
}) {
  const frozen = privateRegistrationInput(input);
  const target = uploadRegistrationTargetSchema.parse(frozen.target), runId = z.uuid().parse(frozen.runId);
  const file = frozen.file;
  if (frozen.group.importSource !== "upload" || file.problem || file.drm ||
      !acceptedPublication(file.metadata, { sha256: file.sha256, format: file.format, sizeBytes: file.size,
        s3Key: file.key, manifestKey: file.manifestKey }))
    throw new Error("Upload planning requires actual canonical verified publication");
  const base = await readGroupCatalogue(conn, frozen.group, [file]);
  // A plain refusal the page can show, not an uncertain outcome: the file waits with Preview (SLN-672)
  if (base.bySha.size) throw new UploadError(409, "upload_already_stored", "This exact file is already in the library.");
  let catalogue: GroupCatalogue = { bySha: base.bySha, ebook: null };
  if (target.kind !== "new") {
    const snapshot = await readUploadTargetSnapshotOn(conn, { ebookIds: [target.ebookId], runId });
    const ebook = snapshot.ebooks.find((row) => row.id === target.ebookId);
    if (!ebook || uploadTargetRowsFingerprint(snapshot) !== target.beforeFingerprint)
      throw new Error("Explicit upload target changed; prepare again");
    catalogue = { bySha: base.bySha, ebook: { id: target.ebookId,
      preferredFileId: z.uuid().nullable().parse(ebook.preferred_file_id), coverKey: z.string().nullable().parse(ebook.cover_key),
      updatedAt: new Date(z.string().parse(ebook.updated_at)), files: snapshot.ebook_files.map(catalogueFile) } };
  }
  const registration = planRegistration(frozen.group, [file], catalogue, { host: null, at: frozen.at });
  if (target.kind === "new" ? !registration.newEbook || registration.replaced.length !== 0 :
      !!registration.newEbook || registration.ebookId !== target.ebookId ||
      (target.kind === "add_format" ? registration.replaced.length !== 0 :
        registration.replaced.length !== 1 || registration.replaced[0].fileId !== target.fileId))
    throw new Error("Upload add-format cannot silently replace; select the one explicit replacement");
  const targetSnapshot = await readUploadTargetSnapshotOn(conn, { ebookIds: [registration.ebookId], runId });
  const loaded = await loadMatchCatalogue(conn), existing = loaded.catalogue.source.ebooks.find((row) => row.id === registration.ebookId);
  let classification: UploadRegistrationClassification | undefined;
  if (!existing || existing.matchState === "pending") {
    const replaced = new Set(registration.replaced.map((row) => row.fileId));
    const at = registration.at.toISOString();
    const ebook: MatchEbook = { ...(existing ?? { ...frozen.group.ebook, id: registration.ebookId,
      createdAt: at, updatedAt: at, instanceId: null, matchState: "pending" as const, matchFingerprint: null, files: [] }),
      preferredFileId: registration.preferredAfter,
      files: [...(existing?.files ?? []).map((row) => replaced.has(row.id) ? { ...row, status: "replaced", availability: "blocked" as const } : row),
        ...registration.inserts.map((row) => matchFileFromStoredRow({ id: row.id, ebook_id: row.ebookId, sha256: row.sha256,
          s3_key: row.s3Key, format: row.format, size_bytes: row.sizeBytes, content_type: row.contentType, status: row.status,
          drm: row.drm ?? null, metadata: row.metadata, text_language: row.textLanguage, cover_key: row.coverKey, manifest_key: row.manifestKey }))] };
    const result = scoreNewGroups(loaded, [ebook], registrationPlanSha256(registration)).results[0];
    if (!result || result.skipped || result.ebookId !== registration.ebookId) throw new Error("Actual canonical upload classification missing");
    classification = { snapshot: { rows: loaded.rows }, result };
  }
  return { registration, classification: classification ? immutableMatchingWriterInput(classification) : undefined,
    targetSnapshot, planSha256: registrationPlanSha256(registration, classification) };
}
type RestorationInput = { operation: Omit<MatchOperationIdentity, "planSha256">; ebookId: string;
  original: NonNullable<UploadAtomicBinding["original"]> };
async function planRestorationOn(conn: Db, input: RestorationInput & { fileId: string | null },
  kind: RegistrationRestorationPlan["kind"]) {
  const frozen = immutableMatchingWriterInput(input);
  const targetSnapshot = await readUploadTargetSnapshotOn(conn, { ebookIds: [frozen.ebookId], runId: frozen.operation.runId });
  if (canonicalReviewJson(frozen.original.catalogueAfter) !== canonicalReviewJson({
    ebooks: targetSnapshot.ebooks, ebook_files: targetSnapshot.ebook_files }))
    throw new Error("Original registration exact after-state changed");
  const plan = planRegistrationRestoration({ operation: frozen.operation, ebookId: frozen.ebookId, fileId: frozen.fileId, kind,
    before: frozen.original.catalogueBefore, after: frozen.original.catalogueAfter });
  return { plan, targetSnapshot };
}
export function planUploadRestoreOn(conn: Db, input: RestorationInput & { fileId: string }) {
  return planRestorationOn(conn, input, "restore_registration");
}
export function planUploadUndoOn(conn: Db, input: RestorationInput) {
  return planRestorationOn(conn, { ...input, fileId: null }, "compensate_registration");
}
/** Dispatch to actual canonical writers. Registration/classification/ingest
 * items/lease checks/permanent receipt are one atomic unit, never two commits. */
export function applyUploadMutationOn(conn: Db, mutation:
  | { kind: "registration"; registration: Registration; classification?: UploadRegistrationClassification;
      operation: MatchOperationIdentity; target: string }
  | { kind: "restore_registration" | "compensate_registration"; plan: RegistrationRestorationPlan; target: string },
  options: { uploadExtension: PreparedUploadAtomicExtension }): Promise<unknown[]> {
  if (mutation.kind === "registration") {
    if (mutation.operation.targetDatabase !== mutation.target) throw new Error("Upload runtime database target changed");
    return registerGroup(conn, mutation.registration, mutation.operation.runId, { ...options,
      operation: mutation.operation, classification: mutation.classification });
  }
  return mutation.kind === "restore_registration" ? restoreRegisteredFileOn(conn, mutation.plan, mutation.target, options)
    : compensateRegistrationOn(conn, mutation.plan, mutation.target, options);
}
