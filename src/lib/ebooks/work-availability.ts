import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { uuids } from "@/lib/catalogue/work-store";
import { continueTarget, type ContinueAnchor, type ContinueFile } from "./continue-target";
import { isEbookFileDownloadable, isEbookFileNativeReadable } from "./conditions";
import { formatRank, isEbookFormat, type EbookFormat } from "./formats";
import { catalogueContinueDTO, workEbookDTO, type WorkEbookDTO } from "./catalogue-dto";
import { readTarget, type EbookAvailability } from "./read-target";

export interface LinkedEbookAvailability extends EbookAvailability {
  readonly instanceId: string;
  readonly downloadFormats: readonly EbookFormat[];
  readonly sizeBytes: number;
  readonly unavailableReason: string | null;
}
export interface WorkDigitalAvailability {
  readonly ebooks: readonly LinkedEbookAvailability[];
  readonly read: WorkEbookDTO | null;
}
/** Server-only rows. Storage evidence is consumed here and never spread into UI props. */
export interface WorkEbookAvailabilityRow {
  workId: string;
  originalLanguage: string | null;
  editionId: string;
  editionLanguage: string | null;
  editionYear: number | null;
  instanceId: string;
  ebookId: string;
  title: string;
  preferredFileId: string | null;
  files: ContinueFile[];
  positions: ContinueAnchor[];
}
function formats(files: readonly ContinueFile[]): EbookFormat[] {
  return [...new Set(files.map((file) => file.format).filter(isEbookFormat))]
    .sort((a, b) => formatRank(a) - formatRank(b) || a.localeCompare(b));
}
function unavailableReason(files: readonly ContinueFile[], downloads: readonly ContinueFile[]): string | null {
  if (files.some(isEbookFileNativeReadable)) return null;
  if (downloads.length) return "Download available; this format cannot be opened in the reader.";
  if (files.some((file) => file.drm !== null)) return "Protected by DRM; unavailable in the reader.";
  if (files.some((file) => file.status === "quarantined")) return "Unavailable: file validation failed.";
  if (files.some((file) => file.status === "missing")) return "Unavailable: the stored file is missing.";
  if (files.length && files.every((file) => file.status === "replaced")) return "Unavailable: the file was replaced and no readable replacement is available.";
  return "Unavailable: no verified readable file is available.";
}
/** Work-level selection delegates every file/anchor decision to SLN-497. */
export function projectWorkDigitalAvailability(
  rows: readonly WorkEbookAvailabilityRow[],
  deviceId: string | null,
): Map<string, WorkDigitalAvailability> {
  const grouped = new Map<string, { language: string | null; ebooks: LinkedEbookAvailability[] }>();
  for (const row of rows) {
    const native = row.files.filter(isEbookFileNativeReadable);
    const downloadable = row.files.filter(isEbookFileDownloadable);
    const descriptor = continueTarget({ ebookId: row.ebookId, excluded: false,
      preferredFileId: row.preferredFileId, deviceId, files: row.files, positions: row.positions });
    const ebook: LinkedEbookAvailability = {
      ebookId: row.ebookId, title: row.title, editionId: row.editionId,
      editionLanguage: row.editionLanguage, editionYear: row.editionYear,
      instanceId: row.instanceId, formats: formats(native), downloadFormats: formats(downloadable),
      sizeBytes: downloadable.reduce((total, file) => total + file.sizeBytes, 0),
      unavailableReason: unavailableReason(row.files, downloadable),
      continue: catalogueContinueDTO(descriptor),
    };
    const group = grouped.get(row.workId) ?? { language: row.originalLanguage, ebooks: [] };
    group.ebooks.push(ebook);
    grouped.set(row.workId, group);
  }
  return new Map([...grouped].map(([workId, group]) => {
    const chosen = readTarget(group.ebooks, group.language);
    return [workId, { ebooks: group.ebooks, read: chosen ? workEbookDTO(chosen) : null }];
  }));
}

/** One query per shown batch, including historical source files for valid replaced-file anchors. */
export function workEbookAvailabilityQuery(workIds: readonly string[], includePositions = true): SQL {
  return sql`select w.id as "workId", w.original_language as "originalLanguage",
    edition.id as "editionId", edition.language as "editionLanguage", edition.publication_year as "editionYear",
    copy.id as "instanceId", ebook.id as "ebookId", ebook.title, ebook.preferred_file_id as "preferredFileId",
    coalesce((select json_agg(json_build_object(
      'id', file.id, 'ebookId', file.ebook_id, 'sha256', file.sha256, 's3Key', file.s3_key,
      'format', file.format, 'sizeBytes', file.size_bytes, 'status', file.status, 'drm', file.drm,
      'metadata', file.metadata, 'manifestKey', file.manifest_key, 'createdAt', file.created_at)
      order by file.created_at, file.id) from ebook_files file where file.ebook_id = ebook.id), '[]'::json) as files,
    ${includePositions ? sql`coalesce((select json_agg(json_build_object(
      'deviceId', place.device_id, 'deviceLabel', place.device_label, 'fileId', place.file_id,
      'locator', place.locator, 'chapter', place.chapter, 'clientUpdatedAt', place.client_updated_at)
      order by place.client_updated_at desc, place.device_id, place.file_id)
      from ebook_positions place where place.ebook_id = ebook.id), '[]'::json)` : sql`'[]'::json`} as positions
    from works w join editions edition on edition.work_id = w.id
    join instances copy on copy.edition_id = edition.id and copy.status <> 'deaccessioned'
    join ebooks ebook on ebook.instance_id = copy.id and ebook.match_state = 'linked'
    where w.kind = 'book' and w.id in (${uuids(workIds)})
    order by w.id, edition.id, ebook.id`;
}
export async function getWorkDigitalAvailability(
  workIds: readonly string[],
  options: { deviceId?: string | null; includePositions?: boolean; database?: { execute(query: SQL): PromiseLike<unknown> } } = {},
): Promise<Map<string, WorkDigitalAvailability>> {
  const ids = [...new Set(workIds)];
  if (!ids.length) return new Map();
  const rows = resultRows<WorkEbookAvailabilityRow>(await (options.database ?? db).execute(workEbookAvailabilityQuery(ids, options.includePositions ?? true)));
  return projectWorkDigitalAvailability(rows, options.deviceId ?? null);
}
