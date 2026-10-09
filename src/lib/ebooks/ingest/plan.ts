import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isNotNull } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { ebookFiles, ebooks } from "@/lib/db/schema";
import type { IngestOutcome } from "@/lib/db/schema/ebook-ingest";
import type { EbookFormat } from "../formats";
import { ebookExtension } from "../keys";
import { stageFile, type Medallion } from "../medallion";
import { groupFiles, walkRoots, type FoundFile } from "./group";
import { HashCache } from "./hash";
import { parseOpf } from "./inspect/opf";
import type { DrmKind, FileMetadata } from "./inspect/types";
import { mergeMetadata, storable, storableText, type MergedMetadata, type MetadataSource } from "./metadata";
import { derivedCachePath, prepareFile, sniffSource, type DerivedObject, type TextCounts } from "./prepare";
import { planRegistration, type CatalogueFileRow, type GroupCatalogue } from "./register";
import { openFileSource, type ByteSource } from "./source";

/*
 * The plan of an ingestion (SLN-494): read-only. Every file under the roots
 * is sniffed; every e-book is hashed, inspected, its covers and manifest
 * made into the cache folder and its text counted; files are grouped into
 * e-books and checked against the catalogue. The plan names the exact
 * objects and rows an apply will write, with each input's fingerprint.
 */

export const INGEST_TOOL_VERSION = 2;
/** Files larger than this are listed and never stored */
export const MAX_FILE_BYTES = 4 * 1024 ** 3;
/** Formats taken only inside a folder with a sidecar OPF, or with --include-text */
const TEXT_FORMATS = new Set<EbookFormat>(["txt", "rtf", "docx"]);
/**
 * S3 Intelligent-Tiering's frequent-access price in eu-north-1 (the same as
 * S3 Standard there), US dollars per GB-month, from AWS's S3 price list as
 * known on 7 October 2026. Only an estimate for the plan's report.
 */
export const EBOOK_STORAGE_PRICE_PER_GB_MONTH = 0.022;
/** Intelligent-Tiering's monitoring charge, per 1,000 objects over 128 KB a month */
export const EBOOK_MONITORING_PRICE_PER_1000 = 0.0025;
const HASHES_AT_ONCE = 4;

export interface PlanTarget {
  /** A fingerprint of the database's host, port and name: never its credentials */
  database: string;
  bucket: string;
  prefix: string;
  region?: string;
  credentialIdentity?: string;
  previewRoot?: string | null;
  /** The objects are files in a preview's folder */
  preview: boolean;
}

export interface PlanFile {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
  format: EbookFormat;
  contentType: string;
  key: string;
  medallion?: Medallion;
  originalFilename: string;
  /** The name a browser saves it under: "<title>.<ext>" */
  downloadName: string;
  drm: DrmKind | null;
  problem: string | null;
  /** ebook_files.metadata: what the file says (with a sidecar's fields over it, the file's own under `embedded`) */
  metadata: Record<string, unknown>;
  text: TextCounts;
  derived: (DerivedObject & { key: string })[];
  manifestKey: string | null;
  coverKey: string | null;
}

export interface PlanGroup {
  key: string;
  folder: string;
  sidecar: string | null;
  importSource: "folder" | "upload";
  /** The sidecar's uuid: the folder's other formats, and the same book dropped in again, join one e-book */
  importRef: string | null;
  /** The sidecar carries a rating, read dates or custom columns: counted, never imported */
  personalData: boolean;
  /** The catalogued e-book this group adds to, as the plan found it */
  existingEbookId: string | null;
  ebook: MergedMetadata;
  /** Its stored paths (files[path]) */
  paths: string[];
}

export interface PlanItem {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string | null;
  format: EbookFormat | null;
  outcome: IngestOutcome;
  reason: string | null;
  /** The group of a stored path */
  group: number | null;
  /** The path whose bytes these are, for a duplicate */
  duplicateOf: string | null;
}

export interface PlanSummary {
  found: number;
  filesByFormat: Record<string, number>;
  ebooksToCreate: number;
  formatsToAdd: number;
  changed: number;
  alreadyStored: number;
  /** Files with no row whose object is in the bucket already (an earlier run stopped between the two): adopted */
  alreadyInBucket: number;
  duplicates: number;
  drm: Record<string, number>;
  quarantined: { path: string; reason: string }[];
  ignored: Record<string, number>;
  personalData: number;
  uploadBytes: number;
  uploadObjects: number;
  /** Bytes a second the last apply on this machine uploaded at; null before the first */
  uploadSpeed: number | null;
  estimatedSeconds: number | null;
  monthlyCostUsd: number;
}

export interface IngestPlan {
  v: 1;
  toolVersion: number;
  createdAt: string;
  host: string;
  roots: string[];
  includeText: boolean;
  exclude: string[];
  /** --limit: only the first files were planned */
  limit: number | null;
  target: PlanTarget;
  items: PlanItem[];
  files: Record<string, PlanFile>;
  groups: PlanGroup[];
  summary: PlanSummary;
}

export interface PlanOptions {
  /** A read-only session */
  database: Db;
  host: string;
  cacheDir: string;
  target: PlanTarget;
  limit?: number;
  includeText?: boolean;
  exclude?: string[];
  uploadSpeed?: number | null;
  /** The keys under files/ in the bucket now: an object there with no row is adopted, not uploaded */
  storedKeys?: Set<string>;
  now?: number;
  onProgress?: (done: number, total: number) => void;
}

const METADATA_SOURCE: Partial<Record<EbookFormat, MetadataSource>> = {
  epub: "epub",
  kepub: "epub",
  azw3: "azw3",
  mobi: "mobi",
  azw: "mobi",
  fb2: "fb2",
  fbz: "fb2",
  pdf: "pdf",
  cbz: "cbz",
};

interface Examined {
  found: FoundFile;
  outcome?: IngestOutcome;
  reason?: string;
  sha256?: string;
  format?: EbookFormat;
  prepared?: Awaited<ReturnType<typeof prepareFile>>;
}

/** Why a found file is not opened at all: empty or too large */
export function sizeReason(size: number): string | null {
  if (size === 0) return "Empty file";
  if (size > MAX_FILE_BYTES) return "Larger than 4 GiB";
  return null;
}

/** The reason a file that cannot be opened is listed with */
export const unreadable = (error: unknown) => `Cannot be read: ${(error as Error).message ?? String(error)}`;

/** What a found file is, and why it is not taken when it is not */
export async function sniffTaken(
  source: ByteSource,
  options: { sidecar: boolean; includeText: boolean },
): Promise<{ format: EbookFormat; reason: null } | { format: EbookFormat | null; reason: string }> {
  const sniff = await sniffSource(source);
  if (sniff.kind === "not-ebook") return { format: null, reason: sniff.reason };
  if (TEXT_FORMATS.has(sniff.format) && !options.sidecar && !options.includeText)
    return { format: sniff.format, reason: "Text file, not taken; add --include-text to take it" };
  return { format: sniff.format, reason: null };
}

export async function pooled<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const at = next++;
        results[at] = await work(items[at], at);
      }
    }),
  );
  return results;
}

/** The sidecar's fields over the file's own, one by one; the file's own under `embedded` */
function fileMetadata(embedded: FileMetadata, sidecar: FileMetadata | null, extra: Record<string, unknown>): Record<string, unknown> {
  if (!sidecar) return { ...embedded, ...extra };
  const merged: Record<string, unknown> = { ...embedded };
  for (const [field, value] of Object.entries(sidecar)) {
    const empty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    if (!empty) merged[field] = value;
  }
  return { ...merged, embedded, sidecar: true, ...extra };
}

/** Plans an ingestion of the roots. Writes nothing to the database or the bucket. */
export async function planIngest(roots: string[], options: PlanOptions): Promise<IngestPlan> {
  const now = options.now ?? Date.now();
  const { files: walked, sidecars } = await walkRoots(roots, { exclude: options.exclude });
  const found = options.limit ? walked.slice(0, options.limit) : walked;
  const hashes = new HashCache(options.cacheDir);
  let done = 0;

  const examined = await pooled(found, HASHES_AT_ONCE, async (file): Promise<Examined> => {
    try {
      const tooBig = sizeReason(file.size);
      if (tooBig) return { found: file, outcome: "ignored", reason: tooBig };
      const source = await openFileSource(file.path, file.name);
      try {
        const taken = await sniffTaken(source, { sidecar: sidecars.has(file.folder), includeText: !!options.includeText });
        if (taken.reason !== null) return { found: file, outcome: "ignored", reason: taken.reason, format: taken.format ?? undefined };
        const { sha256 } = await hashes.hash(file.path);
        // What a file says reaches rows and reports only as text PostgreSQL stores
        const prepared = storable(await prepareFile(source, sha256, taken.format, options.cacheDir));
        return { found: file, sha256, format: taken.format, prepared };
      } finally {
        await source.close();
        options.onProgress?.(++done, found.length);
      }
    } catch (error) {
      return { found: file, outcome: "ignored", reason: unreadable(error) };
    }
  });

  // Sidecars of the folders that hold e-books
  const sidecarInfo = new Map<string, { metadata: FileMetadata; uuid: string | null; personal: boolean; path: string }>();
  for (const folder of new Set(examined.filter((e) => e.prepared).map((e) => e.found.folder))) {
    const sidecar = sidecars.get(folder);
    if (!sidecar) continue;
    try {
      const opf = parseOpf(readFileSync(sidecar, "utf8"));
      sidecarInfo.set(folder, { metadata: storable(opf.metadata), uuid: opf.uuid && storableText(opf.uuid), personal: opf.hasPersonalData, path: sidecar });
    } catch {
      // A sidecar that cannot be read is no sidecar: the folder's files group by name
    }
  }

  const candidates = examined.filter((e): e is Examined & { sha256: string; format: EbookFormat; prepared: NonNullable<Examined["prepared"]> } => !!e.prepared);
  const { groups: fileGroups, duplicates } = groupFiles(
    candidates.map((e) => ({ path: e.found.path, folder: e.found.folder, name: e.found.name, sha256: e.sha256, sidecar: sidecarInfo.has(e.found.folder) })),
  );
  const byPath = new Map(candidates.map((e) => [e.found.path, e]));

  // The catalogue, one query per table
  const catalogueFiles = (await options.database
    .select({ id: ebookFiles.id, ebookId: ebookFiles.ebookId, sha256: ebookFiles.sha256, format: ebookFiles.format, status: ebookFiles.status, drm: ebookFiles.drm, coverKey: ebookFiles.coverKey,
      metadata: ebookFiles.metadata,
      createdAt: ebookFiles.createdAt,
    })
    .from(ebookFiles)) as CatalogueFileRow[];
  const catalogueEbooks = await options.database
    .select({ id: ebooks.id, importSource: ebooks.importSource, importRef: ebooks.importRef, preferredFileId: ebooks.preferredFileId, coverKey: ebooks.coverKey })
    .from(ebooks)
    .where(isNotNull(ebooks.importRef));
  const filesBySha = new Map(catalogueFiles.map((f) => [f.sha256, f]));
  const ebookByRef = new Map(catalogueEbooks.filter((e) => e.importSource === "folder").map((e) => [e.importRef!, e]));

  const planFiles: Record<string, PlanFile> = {};
  const groups: PlanGroup[] = [];
  const outcomes = new Map<string, IngestOutcome>();
  /** Sidecar uuids a group of this plan creates an e-book for: a later folder with the same uuid adds to it */
  const plannedRefs = new Set<string>();
  for (const fileGroup of fileGroups) {
    const sidecar = fileGroup.sidecar ? (sidecarInfo.get(fileGroup.folder) ?? null) : null;
    const members = fileGroup.paths.map((p) => byPath.get(p)!);
    const ebook = mergeMetadata(
      [
        ...(sidecar ? [{ source: "sidecar" as const, metadata: sidecar.metadata }] : []),
        ...members.flatMap((m) => (METADATA_SOURCE[m.format] ? [{ source: METADATA_SOURCE[m.format]!, metadata: m.prepared.metadata }] : [])),
      ],
      members[0].found.name,
    );
    for (const m of members) {
      const ext = ebookExtension(m.format);
      const metadata = fileMetadata(m.prepared.metadata, sidecar?.metadata ?? null, {
          details: m.prepared.details,
          ...(m.prepared.problem ? { problem: m.prepared.problem } : {}),
          ...(m.prepared.text.reason ? { textReason: m.prepared.text.reason } : {}),
          ...(m.prepared.coverReason ? { coverReason: m.prepared.coverReason } : {}),
        });
      const staged = stageFile(m.prepared, metadata, readFileSync(derivedCachePath(options.cacheDir, m.sha256, "manifest.json")), {
        sourceHost: options.host,
        sourcePath: m.found.path,
        sourceMtimeMs: m.found.mtimeMs,
        plannedAt: new Date(now).toISOString(),
      });
      const { medallion, derived } = staged;
      const evidenceDir = path.join(options.cacheDir, "silver");
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(path.join(evidenceDir, `${medallion.silver.sha256}.json`), staged.report);
      const publicationDir = path.join(options.cacheDir, "publications", medallion.silver.sha256);
      mkdirSync(publicationDir, { recursive: true });
      writeFileSync(path.join(publicationDir, "manifest.json"), staged.publication);
      planFiles[m.found.path] = {
        path: m.found.path,
        size: m.found.size,
        mtimeMs: m.found.mtimeMs,
        sha256: m.sha256,
        format: m.format,
        contentType: m.prepared.contentType,
        key: staged.key,
        medallion,
        originalFilename: m.found.name,
        downloadName: `${ebook.title}.${ext}`,
        drm: m.prepared.drm,
        problem: medallion.validation.downloadable ? null : medallion.validation.reason,
        metadata: {
          ...metadata,
          medallion,
          ...(!medallion.validation.downloadable ? { problem: medallion.validation.reason } : {}),
        },
        text: m.prepared.text,
        derived,
        manifestKey: derived.find((d) => d.name === "manifest.json")?.key ?? null,
        coverKey: derived.find((d) => d.name === "cover-800.webp")?.key ?? null,
      };
    }
    const files = fileGroup.paths.map((p) => planFiles[p]);
    const importRef = sidecar?.uuid ?? null;
    const byRef = importRef ? ebookByRef.get(importRef) : undefined;
    const existingId = byRef?.id ?? files.map((f) => filesBySha.get(f.sha256)?.ebookId).find(Boolean) ?? null;
    const existing = existingId ? (catalogueEbooks.find((e) => e.id === existingId) ?? null) : null;
    const group: PlanGroup = {
      key: fileGroup.key,
      folder: fileGroup.folder,
      sidecar: sidecar?.path ?? null,
      importSource: "folder",
      importRef,
      personalData: !!sidecar?.personal,
      existingEbookId: existingId,
      ebook,
      paths: fileGroup.paths,
    };
    // The outcomes the apply will reach, by the same rules it uses
    const joinsPlanned = !existingId && !!importRef && plannedRefs.has(importRef);
    if (importRef && !existingId) plannedRefs.add(importRef);
    const catalogue: GroupCatalogue = {
      bySha: new Map(files.flatMap((f) => (filesBySha.has(f.sha256) ? [[f.sha256, filesBySha.get(f.sha256)!] as const] : []))),
      ebook: existingId
        ? { id: existingId, preferredFileId: existing?.preferredFileId ?? null, coverKey: existing?.coverKey ?? null, files: catalogueFiles.filter((f) => f.ebookId === existingId),
          }
        : joinsPlanned
          ? { id: `planned:${importRef}`, preferredFileId: null, coverKey: null, files: [] }
          : null,
    };
    for (const item of planRegistration(group, files, catalogue, { host: options.host, at: new Date(now) }).items) outcomes.set(item.path, item.outcome);
    groups.push(group);
  }
  const groupOf = new Map(groups.flatMap((g, i) => g.paths.map((p) => [p, i] as const)));

  const items: PlanItem[] = examined.map((e) => {
    const duplicateOf = duplicates.get(e.found.path) ?? null;
    return {
      path: e.found.path,
      size: e.found.size,
      mtimeMs: e.found.mtimeMs,
      sha256: e.sha256 ?? null,
      format: e.format ?? null,
      outcome: e.outcome ?? (duplicateOf ? "duplicate_in_run" : outcomes.get(e.found.path)!),
      reason: e.reason ?? (duplicateOf ? `Same bytes as ${duplicateOf}` : (planFiles[e.found.path]?.problem ?? null)),
      group: groupOf.get(e.found.path) ?? null,
      duplicateOf,
    };
  });

  return {
    v: 1,
    toolVersion: INGEST_TOOL_VERSION,
    createdAt: new Date(now).toISOString(),
    host: options.host,
    roots: roots.map((r) => path.resolve(r)),
    includeText: !!options.includeText,
    exclude: options.exclude ?? [],
    limit: options.limit ?? null,
    target: options.target,
    items,
    files: planFiles,
    groups,
    summary: summarize(items, planFiles, groups, options.uploadSpeed ?? null, options.storedKeys ?? new Set()),
  };
}

function summarize(items: PlanItem[], files: Record<string, PlanFile>, groups: PlanGroup[], uploadSpeed: number | null, storedKeys: Set<string>): PlanSummary {
  const count = (outcome: IngestOutcome) => items.filter((i) => i.outcome === outcome).length;
  const tally = (values: string[]) => values.reduce<Record<string, number>>((all, v) => ((all[v] = (all[v] ?? 0) + 1), all), {});
  const toStore = items.filter((i) => ["new_ebook", "new_format", "replaced_file", "quarantined"].includes(i.outcome)).map((i) => files[i.path]);
  const toUpload = toStore.filter((f) => !storedKeys.has(f.key));
  const uploadBytes = toStore.reduce((n, f) => n +
      (f.medallion
        ? [f.medallion.bronze, f.medallion.silver, ...f.medallion.gold].filter((o) => !storedKeys.has(o.key)).reduce((m, o) => m + o.size, 0)
        : f.size + f.derived.reduce((m, d) => m + d.size, 0)), 0,
  );
  const uploadObjects = toStore.reduce((n, f) => n + (f.medallion ? [f.medallion.bronze, f.medallion.silver, ...f.medallion.gold].filter((o) => !storedKeys.has(o.key)).length : 1 + f.derived.length), 0,
  );
  const largeObjects = toUpload.filter((f) => f.size > 128 * 1024).length;
  const gb = uploadBytes / 1024 ** 3;
  return {
    found: items.length,
    filesByFormat: tally(items.filter((i) => i.format && i.outcome !== "ignored").map((i) => i.format!)),
    // Folders with one sidecar uuid make one e-book
    ebooksToCreate: new Set(groups.filter((g) => !g.existingEbookId).map((g) => g.importRef ?? g.key)).size,
    formatsToAdd: count("new_format"),
    changed: count("replaced_file"),
    alreadyStored: count("already_stored"),
    alreadyInBucket: toStore.length - toUpload.length,
    duplicates: count("duplicate_in_run"),
    drm: tally(Object.values(files).filter((f) => f.drm && items.some((i) => i.path === f.path && i.outcome !== "already_stored")).map((f) => f.drm!),
    ),
    quarantined: items.filter((i) => i.outcome === "quarantined").map((i) => ({ path: i.path, reason: i.reason ?? "" })),
    ignored: tally(items.filter((i) => i.outcome === "ignored").map((i) => i.reason ?? "")),
    personalData: groups.filter((g) => g.personalData).reduce((n, g) => n + g.paths.length, 0),
    uploadBytes,
    uploadObjects,
    uploadSpeed,
    estimatedSeconds: uploadSpeed ? Math.ceil(uploadBytes / uploadSpeed) : null,
    monthlyCostUsd: Math.round((gb * EBOOK_STORAGE_PRICE_PER_GB_MONTH + (largeObjects / 1000) * EBOOK_MONITORING_PRICE_PER_1000) * 100) / 100,
  };
}
