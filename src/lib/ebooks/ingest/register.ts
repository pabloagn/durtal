import { uploadRegistrationTargetSchema } from "../upload/registration-target";
import { snapshotGuardQueries } from "../match/guards";
import { classificationQueries } from "../match/classification";
import type { LoadedMatchCatalogue } from "../match/load";
import type { MatchResult } from "../match/types";
import { MATCH_MODEL } from "../match/model";
import { requireFiniteScore, requireMatchProbability } from "../match/validation";
import { z } from "zod/v4";
import { privateRegistrationInput, registrationInputSha256 } from "./registration-input";
import { immutableMatchingWriterInput } from "../match/writer-input";
import { reviewOperationSchema } from "@/lib/validations/ebook-review";
import type { MatchOperationIdentity } from "../match/types";
import { lockSql } from "@/lib/harmonization/store";
import { requireUploadAtomicExtension, requireUploadPublicationFiles, requireUploadRegistrationSource,
  uploadForwardUpdatedAt, uploadTargetSnapshotOf, uploadOriginalCatalogueOf, uploadRegistrationIntentOf,
  type PreparedUploadAtomicExtension } from "../upload/atomic-extension-registry";
import { canonicalReviewJson, reviewPayloadHash } from "../review/receipts";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { atomicOn } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { ebookFiles, ebookIngestItems, ebooks } from "@/lib/db/schema";
import type { IngestOutcome } from "@/lib/db/schema/ebook-ingest";
import { medallionOf } from "../medallion";
import { formatRank, isReadableFormat } from "../formats";
import type { PlanFile, PlanGroup } from "./plan";

/*
 * An e-book group's rows (SLN-494), written in one atomic per group with
 * every new id given up front: a new e-book with its files; a new format of
 * an e-book already catalogued; or a changed file, which is added while the
 * old one becomes `replaced`. The run's items are updated in the same
 * atomic, so a file is never registered twice: the unique sha256 and the
 * atomic see to it. New e-books are `pending`; matching comes later.
 */

export interface CatalogueFileRow {
  id: string;
  ebookId: string;
  sha256: string;
  format: string;
  status: string;
  drm: string | null;
  coverKey: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface GroupCatalogue {
  /** Files already stored, by checksum */
  bySha: Map<string, CatalogueFileRow>;
  /** The e-book this group adds to, when it exists; `updatedAt` only when read from the database */
  ebook: { id: string; preferredFileId: string | null; coverKey: string | null; updatedAt?: Date; files: CatalogueFileRow[] } | null;
}

const FILE_COLUMNS = {
  id: ebookFiles.id,
  ebookId: ebookFiles.ebookId,
  sha256: ebookFiles.sha256,
  format: ebookFiles.format,
  status: ebookFiles.status,
  drm: ebookFiles.drm,
  coverKey: ebookFiles.coverKey,
  metadata: ebookFiles.metadata,
  createdAt: ebookFiles.createdAt,
};

/** What the catalogue holds for one group now: its files by checksum, and the e-book it joins */
export async function readGroupCatalogue(database: Db, group: PlanGroup, files: PlanFile[]): Promise<GroupCatalogue> {
  const shas = files.map((f) => f.sha256);
  const rows = shas.length ? await database.select(FILE_COLUMNS).from(ebookFiles).where(inArray(ebookFiles.sha256, shas)) : [];
  const bySha = new Map(rows.map((r) => [r.sha256, r as CatalogueFileRow]));
  let ebookId: string | null = null;
  if (group.importRef) {
    const [byRef] = await database
      .select({ id: ebooks.id })
      .from(ebooks)
      .where(and(eq(ebooks.importSource, group.importSource), eq(ebooks.importRef, group.importRef)))
      .limit(1);
    ebookId = byRef?.id ?? null;
  }
  ebookId ??= rows[0]?.ebookId ?? null;
  if (!ebookId) return { bySha, ebook: null };
  const [ebook] = await database
    .select({ id: ebooks.id, preferredFileId: ebooks.preferredFileId, coverKey: ebooks.coverKey, updatedAt: ebooks.updatedAt })
    .from(ebooks)
    .where(eq(ebooks.id, ebookId));
  if (!ebook) return { bySha, ebook: null };
  const own = await database.select(FILE_COLUMNS).from(ebookFiles).where(eq(ebookFiles.ebookId, ebookId));
  return { bySha, ebook: { ...ebook, files: own as CatalogueFileRow[] } };
}

export interface RegisteredItem {
  path: string;
  outcome: IngestOutcome;
  /** Why a quarantined file was quarantined */
  reason: string | null;
  ebookId: string;
  fileId: string;
}

export interface Registration {
  ebookId: string;
  newEbook: typeof ebooks.$inferInsert | null;
  inserts: (typeof ebookFiles.$inferInsert)[];
  replaced: { fileId: string; previousStatus: string }[];
  preferredBefore: string | null;
  coverBefore: string | null;
  preferredAfter: string | null;
  coverAfter: string | null;
  /** The e-book's `updated_at` before this group, when it existed */
  updatedBefore: Date | null;
  items: RegisteredItem[];
  at: Date;
}

interface Candidate {
  id: string;
  format: string;
  status: string;
  drm: string | null;
  coverKey: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const deliverable = (f: Candidate) => (f.status === "stored" || f.status === "verified") && !f.drm && isReadableFormat(f.format) && (!medallionOf(f.metadata) || medallionOf(f.metadata)!.validation.nativeReadable);

/** The file the reader opens first: readable, no DRM, by FORMAT_PREFERENCE, the newest first */
export function preferredFile<T extends Candidate>(files: T[]): T | null {
  return [...files].filter(deliverable).sort((a, b) => formatRank(a.format) - formatRank(b.format) || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

/** The rows one group needs, with every new id given up front. Pure. */
export function planRegistration(
  group: PlanGroup,
  files: PlanFile[],
  catalogue: GroupCatalogue,
  options: { host: string | null; at: Date }): Registration {
  const at = options.at;
  const ebookId = catalogue.ebook?.id ?? randomUUID();
  const existing = catalogue.ebook?.files ?? [];
  const items: RegisteredItem[] = [];
  const inserts: (typeof ebookFiles.$inferInsert)[] = [];
  const replaced = new Map<string, string>();
  let createdOne = false;

  // Readable files first, so the new e-book's item is one a reader can open
  const ordered = [...files].sort((a, b) => Number(!!a.problem) - Number(!!b.problem) || Number(!!a.drm) - Number(!!b.drm) || formatRank(a.format) - formatRank(b.format));
  for (const file of ordered) {
    const stored = catalogue.bySha.get(file.sha256);
    if (stored) {
      items.push({ path: file.path, outcome: "already_stored", reason: null, ebookId: stored.ebookId, fileId: stored.id });
      continue;
    }
    const fileId = randomUUID();
    let outcome: IngestOutcome;
    const older = catalogue.ebook ? existing.filter((f) => f.format === file.format && f.status !== "replaced" && f.sha256 !== file.sha256) : [];
    if (file.problem) outcome = "quarantined";
    else if (older.length) {
      outcome = "replaced_file";
      for (const old of older) replaced.set(old.id, old.status);
    } else if (!catalogue.ebook && !createdOne) {
      outcome = "new_ebook";
      createdOne = true;
    } else outcome = "new_format";
    inserts.push({
      id: fileId,
      ebookId,
      sha256: file.sha256,
      format: file.format,
      sizeBytes: file.size,
      contentType: file.contentType,
      originalFilename: file.originalFilename,
      s3Key: file.key,
      status: file.problem ? "quarantined" : "stored",
      drm: file.drm,
      sourceHost: options.host,
      sourcePath: file.path,
      sourceMtime: new Date(file.mtimeMs),
      metadata: file.metadata,
      wordCount: file.text.wordCount,
      charCount: file.text.charCount,
      frontBackWordCount: file.text.frontBackWordCount,
      pageEstimate: file.text.pageEstimate,
      textLanguage: file.text.language,
      textToolVersion: file.text.toolVersion,
      manifestKey: file.manifestKey,
      coverKey: file.coverKey,
      createdAt: at,
      updatedAt: at,
    });
    items.push({ path: file.path, outcome, reason: file.problem, ebookId, fileId });
  }

  // The preferred file: kept unless it was replaced or cannot be read; a replaced one moves to its successor
  const after: Candidate[] = [
    ...existing.map((f) => (replaced.has(f.id) ? { ...f, status: "replaced" } : f)),
    ...inserts.map((f) => ({ id: f.id!, format: f.format, status: f.status, drm: f.drm ?? null, coverKey: f.coverKey ?? null, metadata: f.metadata ?? {}, createdAt: at })),
  ];
  const before = catalogue.ebook?.preferredFileId ?? null;
  const keep = after.find((f) => f.id === before && deliverable(f));
  const successor = before && replaced.has(before) ? after.find((f) => f.createdAt === at && f.format === existing.find((e) => e.id === before)?.format && deliverable(f)) : undefined;
  const chosen = keep ?? successor ?? preferredFile(after);

  const ebook = group.ebook;
  return {
    ebookId,
    newEbook: catalogue.ebook
      ? null
      : {
          id: ebookId,
          title: ebook.title,
          titleSort: ebook.titleSort,
          subtitle: ebook.subtitle,
          authors: ebook.authors,
          authorSort: ebook.authorSort,
          language: ebook.language,
          isbns: ebook.isbns,
          identifiers: ebook.identifiers,
          series: ebook.series,
          seriesIndex: ebook.seriesIndex,
          publisher: ebook.publisher,
          publishedYear: ebook.publishedYear,
          description: ebook.description,
          matchState: "pending",
          importSource: group.importSource,
          importRef: group.importRef,
          searchText: ebook.searchText,
          createdAt: at,
          updatedAt: at,
        },
    inserts,
    replaced: [...replaced].map(([fileId, previousStatus]) => ({ fileId, previousStatus })),
    preferredBefore: before,
    coverBefore: catalogue.ebook?.coverKey ?? null,
    preferredAfter: chosen?.id ?? null,
    coverAfter: chosen?.coverKey ?? (catalogue.ebook ? catalogue.ebook.coverKey : null),
    updatedBefore: catalogue.ebook?.updatedAt ?? null,
    items,
    at,
  };
}

export interface UploadRegistrationClassification {
  snapshot: Pick<LoadedMatchCatalogue, "rows">;
  result: MatchResult;
}
export interface UploadRegistrationOptions {
  uploadExtension: PreparedUploadAtomicExtension;
  operation: MatchOperationIdentity;
  classification?: UploadRegistrationClassification;
}
export function registrationPlanSha256(registration: Registration, classification?: UploadRegistrationClassification): string {
  return registrationInputSha256(classification === undefined ? registration : { registration, classification });
}
function prepareUploadRegistration(r: Registration, runId: string, options: UploadRegistrationOptions) {
  const operation = reviewOperationSchema.parse(immutableMatchingWriterInput(options.operation));
  const extension = requireUploadAtomicExtension(options.uploadExtension, {
    coreWriter: "registration", coreOperation: operation, ebookIds: [r.ebookId], purpose: "effect",
  });
  const id = z.uuid();
  id.parse(r.ebookId); id.parse(runId);
  if (operation.runId !== runId || operation.planSha256 !== registrationPlanSha256(r, options.classification) ||
      r.inserts.length !== 1 || r.items.length !== 1 || r.items[0].ebookId !== r.ebookId ||
      r.items[0].fileId !== r.inserts[0].id || !["new_ebook", "new_format", "replaced_file"].includes(r.items[0].outcome) ||
      r.newEbook && (r.newEbook.id !== r.ebookId || r.newEbook.matchState !== "pending" || r.newEbook.instanceId != null) ||
      new Set(r.replaced.map((row) => row.fileId)).size !== r.replaced.length)
    throw new Error("Upload registration identity, rows or plan hash changed");
  const f = r.inserts[0];
  if (!f.id || f.ebookId !== r.ebookId || !f.metadata || !f.manifestKey || f.drm ||
      f.status !== "stored" || f.sourcePath !== r.items[0].path || r.items[0].reason !== null)
    throw new Error("Upload registration lacks its verified readable publication");
  id.parse(f.id);
  requireUploadPublicationFiles(extension, [{ id: f.id, ebookId: r.ebookId, sha256: f.sha256,
    format: f.format, sizeBytes: f.sizeBytes, s3Key: f.s3Key, manifestKey: f.manifestKey, metadata: f.metadata }]);
  requireUploadRegistrationSource(extension, { runId, path: r.items[0].path, sha256: f.sha256,
    sizeBytes: f.sizeBytes, format: f.format });
  const current = uploadTargetSnapshotOf(extension);
  const intent = uploadRegistrationTargetSchema.parse(uploadRegistrationIntentOf(extension));
  if (intent.kind === "new" ? !r.newEbook || r.replaced.length !== 0 : !!r.newEbook || r.ebookId !== intent.ebookId ||
      (intent.kind === "add_format" ? r.replaced.length !== 0 : r.replaced.length !== 1 || r.replaced[0].fileId !== intent.fileId) ||
      intent.beforeFingerprint !== reviewPayloadHash({ version: 1, ebooks: current.ebooks, ebook_files: current.ebook_files }))
    throw new Error("Upload registration differs from its durable explicit new/add-format/replace intent");
  if (options.classification) {
    const result = options.classification.result;
    if (result.ebookId !== r.ebookId || result.skipped || result.modelVersion !== MATCH_MODEL.version ||
        !r.newEbook && current.ebooks.find((row) => row.id === r.ebookId)?.match_state !== "pending")
      throw new Error("Upload classification requires its actual single pending target");
    for (const candidate of result.candidates) {
      requireMatchProbability(candidate.probability);
      requireFiniteScore(candidate.weightBits, candidate.marginBits);
    }
  }
  const ebook = current.ebooks.find((row) => row.id === r.ebookId);
  if (r.newEbook ? !!ebook : !ebook || ebook.preferred_file_id !== r.preferredBefore || ebook.cover_key !== r.coverBefore)
    throw new Error("Upload registration before-state differs from its protected catalogue");
  for (const replacement of r.replaced) {
    id.parse(replacement.fileId);
    const old = current.ebook_files.find((row) => row.id === replacement.fileId);
    if (!old || old.ebook_id !== r.ebookId || old.status !== replacement.previousStatus || old.format !== f.format || old.sha256 === f.sha256)
      throw new Error("Upload replacement does not name the original same-format file");
  }
  const preferred = current.ebook_files.find((row) => row.id === r.preferredAfter);
  if (r.preferredAfter !== null && r.preferredAfter !== f.id &&
      (!preferred || preferred.ebook_id !== r.ebookId || r.replaced.some((row) => row.fileId === preferred.id)))
    throw new Error("Upload preferred file is outside the resulting registration");
  return extension;
}
/** Writes one registration and its items as one unit: all of it or nothing. */
export function registerGroup(database: Db, registration: Registration, runId: string): Promise<void>;
export function registerGroup(database: Db, registration: Registration, runId: string,
  options: UploadRegistrationOptions): Promise<unknown[]>;
export async function registerGroup(database: Db, registration: Registration, runId: string,
  options?: UploadRegistrationOptions): Promise<void | unknown[]> {
  const r = privateRegistrationInput(registration);
  const classification = options?.classification === undefined ? undefined : immutableMatchingWriterInput(options.classification);
  const extension = options ? prepareUploadRegistration(r, runId, { ...options, classification }) : undefined;
  const replacedIds = r.replaced.map((x) => x.fileId);
  const preferredChanges = r.newEbook ? r.preferredAfter !== null || r.coverAfter !== null : r.preferredAfter !== r.preferredBefore || r.coverAfter !== r.coverBefore;
  const results = await withReadableErrors(() => atomicOn(database, (d) => [
    ...(classification ? snapshotGuardQueries(d, classification.snapshot, extension!.extraTables)
      : extension ? [d.execute(lockSql([...extension.extraTables]))] : []),
    ...(extension?.before(d) ?? []),
    ...(r.newEbook ? [d.insert(ebooks).values(r.newEbook)] : []),
    ...(r.inserts.length ? [d.insert(ebookFiles).values(r.inserts)] : []),
    ...(replacedIds.length ? [d.update(ebookFiles).set({ status: "replaced", updatedAt: extension ? uploadForwardUpdatedAt() : r.at }).where(inArray(ebookFiles.id, replacedIds))] : []),
    ...(preferredChanges || extension
      ? [d.update(ebooks).set({ preferredFileId: r.preferredAfter, coverKey: r.coverAfter,
          updatedAt: extension ? uploadForwardUpdatedAt() : r.at }).where(eq(ebooks.id, r.ebookId))] : []),
    ...r.items.map((item) => d.update(ebookIngestItems)
      .set({ state: "registered", outcome: item.outcome, reason: item.reason, ebookId: item.ebookId,
        fileId: item.fileId, lastError: null, updatedAt: extension ? uploadForwardUpdatedAt() : r.at })
      .where(and(eq(ebookIngestItems.runId, runId), eq(ebookIngestItems.sourcePath, item.path)))),
    ...(classification ? classificationQueries(d, [classification.result], r.at, { touchEbook: false }) : []),
    ...(extension?.after(d) ?? []),
  ]));
  if (extension) return results;
}

const restorationSchema = z.strictObject({
  ...reviewOperationSchema.shape,
  kind: z.enum(["restore_registration", "compensate_registration"]),
  ebookId: z.uuid(),
  fileId: z.uuid().nullable(),
  files: z.array(z.strictObject({ fileId: z.uuid(), status: z.enum(["stored", "verified", "missing", "quarantined", "replaced"]) })),
  preferredAfter: z.uuid().nullable(),
  coverAfter: z.string().nullable(),
});
export type RegistrationRestorationPlan = z.output<typeof restorationSchema>;
export type RegistrationCatalogueSnapshot = {
  ebooks: readonly Record<string, unknown>[];
  ebook_files: readonly Record<string, unknown>[];
};
type RestorationEffect = Pick<RegistrationRestorationPlan, "files" | "preferredAfter" | "coverAfter">;
function registrationRestorationEffect(kind: RegistrationRestorationPlan["kind"], ebookId: string,
  fileId: string | null, before: RegistrationCatalogueSnapshot, after: RegistrationCatalogueSnapshot): RestorationEffect {
  const previous = before.ebook_files.filter((row) => row.ebook_id === ebookId);
  const current = after.ebook_files.filter((row) => row.ebook_id === ebookId);
  const ebook = after.ebooks.find((row) => row.id === ebookId);
  if (!ebook) throw new Error("Original registration after-state lacks its e-book");
  const changes = new Map<string, RegistrationRestorationPlan["files"][number]>();
  const add = (id: unknown, status: unknown) => {
    const change = restorationSchema.shape.files.element.parse({ fileId: id, status });
    changes.set(change.fileId, change);
  };
  if (kind === "restore_registration") {
    const file = previous.find((row) => row.id === fileId);
    const retained = current.find((row) => row.id === fileId);
    if (!file || !retained || !["stored", "verified"].includes(String(file.status)) ||
        retained.status !== "replaced" || retained.sha256 !== file.sha256 || retained.s3_key !== file.s3_key ||
        retained.format !== file.format || retained.manifest_key !== file.manifest_key || retained.drm !== null)
      throw new Error("Restore requires the retained original readable file");
    for (const row of current)
      if (row.id !== fileId && row.format === file.format && ["stored", "verified"].includes(String(row.status)))
        add(row.id, "replaced");
    add(file.id, file.status);
    return { files: [...changes.values()].sort((a, b) => a.fileId.localeCompare(b.fileId)),
      preferredAfter: z.uuid().parse(file.id), coverAfter: z.string().nullable().parse(file.cover_key) };
  }
  if (fileId !== null) throw new Error("Registration compensation does not select a replacement file");
  // Keep every registered file, including files referenced by annotations or
  // places. Only retire files introduced by this registration and restore the
  // exact earlier statuses/pointers; no row deletion or locator rewriting.
  for (const row of current) {
    const old = previous.find((file) => file.id === row.id);
    if (!old) add(row.id, "replaced");
    else if (old.status !== row.status) add(row.id, old.status);
  }
  const oldEbook = before.ebooks.find((row) => row.id === ebookId);
  return { files: [...changes.values()].sort((a, b) => a.fileId.localeCompare(b.fileId)),
    preferredAfter: oldEbook ? z.uuid().nullable().parse(oldEbook.preferred_file_id) : null,
    coverAfter: oldEbook ? z.string().nullable().parse(oldEbook.cover_key) : null };
}
export function registrationRestorationPlanSha256(plan: RegistrationRestorationPlan): string {
  const { planSha256: _hash, ...content } = restorationSchema.parse(immutableMatchingWriterInput(plan));
  return reviewPayloadHash(content);
}
/** Pure source-bound planning. The adapter obtains these full snapshots under
 * its read-only protected connection; the writer rechecks the original durable
 * receipt and exact after-state through its issued capability. */
export function planRegistrationRestoration(input: {
  operation: Omit<MatchOperationIdentity, "planSha256">;
  kind: RegistrationRestorationPlan["kind"];
  ebookId: string; fileId: string | null;
  before: RegistrationCatalogueSnapshot; after: RegistrationCatalogueSnapshot;
}): RegistrationRestorationPlan {
  const frozen = immutableMatchingWriterInput(input);
  const plan = restorationSchema.parse({ ...frozen.operation, planSha256: "0".repeat(64),
    kind: frozen.kind, ebookId: frozen.ebookId, fileId: frozen.fileId,
    ...registrationRestorationEffect(frozen.kind, frozen.ebookId, frozen.fileId, frozen.before, frozen.after) });
  plan.planSha256 = registrationRestorationPlanSha256(plan);
  return immutableMatchingWriterInput(plan);
}
async function writeRegistrationRestoration(database: Db, input: RegistrationRestorationPlan, target: string,
  options: { uploadExtension: PreparedUploadAtomicExtension }, kind: RegistrationRestorationPlan["kind"]): Promise<unknown[]> {
  const plan = restorationSchema.parse(immutableMatchingWriterInput(input));
  if (plan.kind !== kind || plan.targetDatabase !== target || plan.planSha256 !== registrationRestorationPlanSha256(plan))
    throw new Error("Registration restoration target, purpose or plan hash changed");
  const extension = requireUploadAtomicExtension(options.uploadExtension, { coreWriter: kind,
    coreOperation: plan, ebookIds: [plan.ebookId], purpose: kind === "restore_registration" ? "restore" : "compensation" });
  const original = uploadOriginalCatalogueOf(extension);
  if (original.coreWriter !== "registration" || canonicalReviewJson({ files: plan.files,
    preferredAfter: plan.preferredAfter, coverAfter: plan.coverAfter }) !== canonicalReviewJson(
      registrationRestorationEffect(kind, plan.ebookId, plan.fileId, original.catalogueBefore, original.catalogueAfter)))
    throw new Error("Registration restoration differs from the original committed registration");
  if (kind === "restore_registration") {
    const file = original.catalogueAfter.ebook_files.find((row) => row.id === plan.fileId)!;
    requireUploadPublicationFiles(extension, [{ id: z.uuid().parse(file.id), ebookId: plan.ebookId,
      sha256: z.string().parse(file.sha256), format: z.string().parse(file.format), sizeBytes: Number(file.size_bytes),
      s3Key: z.string().parse(file.s3_key), manifestKey: z.string().parse(file.manifest_key),
      metadata: z.record(z.string(), z.unknown()).parse(file.metadata) }]);
  }
  return withReadableErrors(() => atomicOn(database, (d) => [
    d.execute(lockSql([...extension.extraTables])),
    ...extension.before(d),
    // Restrict every changed file to the bound e-book even after full snapshot
    // verification. Reader rows and immutable source/publication columns remain.
    ...plan.files.map((file) => d.update(ebookFiles).set({ status: file.status, updatedAt: uploadForwardUpdatedAt() })
      .where(and(eq(ebookFiles.id, file.fileId), eq(ebookFiles.ebookId, plan.ebookId)))),
    d.update(ebooks).set({ preferredFileId: plan.preferredAfter, coverKey: plan.coverAfter,
      updatedAt: uploadForwardUpdatedAt() }).where(eq(ebooks.id, plan.ebookId)),
    ...extension.after(d),
  ]));
}
export function restoreRegisteredFileOn(database: Db, plan: RegistrationRestorationPlan, target: string,
  options: { uploadExtension: PreparedUploadAtomicExtension }): Promise<unknown[]> {
  return writeRegistrationRestoration(database, plan, target, options, "restore_registration");
}
export function compensateRegistrationOn(database: Db, plan: RegistrationRestorationPlan, target: string,
  options: { uploadExtension: PreparedUploadAtomicExtension }): Promise<unknown[]> {
  return writeRegistrationRestoration(database, plan, target, options, "compensate_registration");
}

/** One group's line in the undo file, written before its atomic */
export interface UndoEntry {
  ebookId: string;
  createdEbook: boolean;
  fileIds: string[];
  replaced: { fileId: string; previousStatus: string }[];
  preferredBefore: string | null;
  coverBefore: string | null;
  preferredAfter: string | null;
  coverAfter: string | null;
  /** The e-book's `updated_at` before the group; absent in undo files written before it was kept */
  updatedBefore?: string | null;
  at: string;
}

export function undoEntry(r: Registration): UndoEntry {
  return {
    ebookId: r.ebookId,
    createdEbook: !!r.newEbook,
    fileIds: r.inserts.map((f) => f.id!),
    replaced: r.replaced,
    preferredBefore: r.preferredBefore,
    coverBefore: r.coverBefore,
    preferredAfter: r.preferredAfter,
    coverAfter: r.coverAfter,
    updatedBefore: r.updatedBefore?.toISOString() ?? null,
    at: r.at.toISOString(),
  };
}

export interface UndoResult {
  ebooksRemoved: number;
  filesRemoved: number;
  /** Rows something changed since the run (a position, an annotation, a link or an edit): kept */
  kept: number;
}

/**
 * Removes what a run created, newest group first, where nothing has changed
 * it since: no position, no annotation, no link and no edit. A replaced file
 * gets its status back, and the preferred file and cover go back when they
 * are still the run's. S3 objects stay: content-addressed and harmless; the
 * orphan report lists them.
 */
export async function undoIngest(database: Db, entries: UndoEntry[]): Promise<UndoResult> {
  const result: UndoResult = { ebooksRemoved: 0, filesRemoved: 0, kept: 0 };
  for (const entry of [...entries].reverse()) {
    const files = entry.fileIds.length
      ? await database
          .select({
            id: ebookFiles.id,
            createdAt: ebookFiles.createdAt,
            updatedAt: ebookFiles.updatedAt,
            // Qualified by hand: drizzle renders a column in a subquery without its table
            positions: sql<number>`(select count(*) from ebook_positions p where p.file_id = ebook_files.id)::int`,
            annotations: sql<number>`(select count(*) from ebook_annotations a where a.file_id = ebook_files.id)::int`,
          })
          .from(ebookFiles)
          .where(inArray(ebookFiles.id, entry.fileIds))
      : [];
    const removable = files.filter((f) => f.positions === 0 && f.annotations === 0 && f.updatedAt.getTime() === f.createdAt.getTime()).map((f) => f.id);
    result.kept += files.length - removable.length;

    const [ebook] = await database
      .select({
        matchState: ebooks.matchState,
        instanceId: ebooks.instanceId,
        createdAt: ebooks.createdAt,
        updatedAt: ebooks.updatedAt,
        preferredFileId: ebooks.preferredFileId,
        files: sql<number>`(select count(*) from ebook_files f where f.ebook_id = ebooks.id)::int`,
      })
      .from(ebooks)
      .where(eq(ebooks.id, entry.ebookId));
    const removeEbook =
      !!ebook &&
      entry.createdEbook &&
      ebook.files === removable.length &&
      ebook.matchState === "pending" &&
      !ebook.instanceId &&
      ebook.updatedAt.getTime() === new Date(entry.at).getTime();
    if (ebook && entry.createdEbook && !removeEbook) result.kept += 1;
    const restorePreferred =
      !!ebook && !entry.createdEbook && (ebook.preferredFileId === entry.preferredAfter || (ebook.preferredFileId && removable.includes(ebook.preferredFileId)));
    // Nothing but this group changed the e-book since: its updated_at goes back too, so the
    // group of the run that created it (a folder with the same sidecar uuid) can remove it
    const restoreUpdated = restorePreferred && !!entry.updatedBefore && ebook!.updatedAt.getTime() === new Date(entry.at).getTime();
    await atomicOn(database, (d) => [
      ...(removable.length ? [d.delete(ebookFiles).where(inArray(ebookFiles.id, removable))] : []),
      ...entry.replaced.map((r) =>
        d.update(ebookFiles).set({ status: r.previousStatus as "stored" }).where(and(eq(ebookFiles.id, r.fileId), eq(ebookFiles.status, "replaced"))),
      ),
      ...(restorePreferred
        ? [
            d
              .update(ebooks)
              .set({ preferredFileId: entry.preferredBefore, coverKey: entry.coverBefore, ...(restoreUpdated ? { updatedAt: new Date(entry.updatedBefore!) } : {}) })
              .where(eq(ebooks.id, entry.ebookId)),
          ]
        : []),
      ...(removeEbook ? [d.delete(ebooks).where(eq(ebooks.id, entry.ebookId))] : []),
    ]);
    result.filesRemoved += removable.length;
    if (removeEbook) result.ebooksRemoved += 1;
  }
  return result;
}
