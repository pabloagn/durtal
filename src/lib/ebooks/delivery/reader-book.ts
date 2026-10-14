import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { formatRank } from "../formats";
import type { ReaderPlace } from "@/lib/reader/sync/places";
import type { CatalogueFile } from "./files";
import { isEbookFileNativeReadable } from "../conditions";
import { continueTarget, validContinueAnchor } from "../continue-target";

/*
 * What the reader page needs, in one query (eBooks sub-issue 3): the
 * e-book, its readable files (stored or verified, no DRM, a format the
 * reader opens), the linked book's page, this device's history and the newest other place.
 * Like the readers in files.ts, it is the only other place that makes
 * CatalogueFiles: the rows were read in this request.
 */

export interface ReaderFile extends CatalogueFile {
  readonly createdAt: string;
  readonly manifestKey: string | null;
  readonly charCount: number | null;
}

export interface ReaderBook {
  id: string;
  title: string;
  authors: string[];
  language: string | null;
  editionLanguage: string | null;
  /** The linked book's page, while its copy is held */
  workSlug: string | null;
  /** Readable files, in FORMAT_PREFERENCE order */
  files: ReaderFile[];
  /** The file to open: `?file=` when readable, else the preferred file, else the first */
  file: ReaderFile | null;
  /** This device's place in `file` */
  place: ReaderPlace | null;
  /** Latest history in any file, to distinguish a new device from a new format. */
  devicePlace: ReaderPlace | null;
  otherPlace: ReaderPlace | null;
  /** Every other device's place, newest first: the offer's newest and furthest (SLN-686) */
  otherPlaces: ReaderPlace[];
}

type Row = Omit<
  ReaderBook,
  "file" | "place" | "devicePlace" | "otherPlace" | "otherPlaces" | "files"
> & {
  preferredFileId: string | null;
  matchState: string;
  files: ReaderFile[];
  places: ReaderPlace[];
};

/** The reader's e-book, or null when there is none */
export async function readReaderBook(
  ebookId: string,
  options: { deviceId?: string | null; fileId?: string | null } = {},
): Promise<ReaderBook | null> {
  const [row] = resultRows<Row>(
    await db.execute(sql`select eb.id, eb.title, eb.authors, eb.language, e.language as "editionLanguage",
        eb.preferred_file_id as "preferredFileId", eb.match_state as "matchState", w.slug as "workSlug",
        coalesce((select json_agg(json_build_object('id', f.id, 'ebookId', f.ebook_id, 'sha256', f.sha256,
            's3Key', f.s3_key, 'format', f.format, 'sizeBytes', f.size_bytes, 'contentType', f.content_type,
            'status', f.status, 'drm', f.drm, 'metadata', f.metadata, 'manifestKey', f.manifest_key, 'charCount', f.char_count, 'createdAt', f.created_at) order by f.created_at, f.id)
          from ebook_files f
          where f.ebook_id = eb.id), '[]'::json) as files,
        coalesce((select json_agg(json_build_object('deviceId', p.device_id, 'deviceLabel', p.device_label,
            'fileId', p.file_id, 'locator', p.locator, 'progression', p.progression,
            'furthestProgression', p.furthest_progression, 'chapter', p.chapter,
            'clientUpdatedAt', p.client_updated_at, 'thisDevice', p.device_id = ${options.deviceId ?? ""})
            order by p.client_updated_at desc, p.device_id, p.file_id)
          from ebook_positions p
          where p.ebook_id = eb.id), '[]'::json) as places
      from ebooks eb
      left join instances i on i.id = eb.instance_id and i.status <> 'deaccessioned'
      left join editions e on e.id = i.edition_id
      left join works w on w.id = e.work_id
      where eb.id = ${ebookId}::uuid`),
  );
  if (!row) return null;
  const places = row.places.filter((place) =>
    validContinueAnchor(
      place,
      row.files.find((file) => file.id === place.fileId),
    ),
  );
  const files = (row.matchState === "excluded" ? [] : row.files)
    .filter(isEbookFileNativeReadable)
    .sort((a, b) => formatRank(a.format) - formatRank(b.format));
  const byId = (id: string | null | undefined) =>
    id ? files.find((f) => f.id === id.toLowerCase()) : undefined;
  const continuation = continueTarget({
    ebookId: row.id,
    excluded: row.matchState === "excluded",
    preferredFileId: row.preferredFileId,
    deviceId: options.deviceId ?? null,
    files: row.files,
    positions: places,
  });
  const file = byId(options.fileId) ?? byId(continuation?.target.id) ?? null;
  const place = file
    ? (places.find((p) => p.thisDevice && p.fileId === file.id) ?? null)
    : null;
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    language: row.language,
    editionLanguage: row.editionLanguage,
    workSlug: row.workSlug,
    files,
    file,
    place,
    devicePlace: places.find((p) => p.thisDevice) ?? null,
    otherPlace: places.find((p) => !p.thisDevice) ?? null,
    otherPlaces: places.filter((p) => !p.thisDevice),
  };
}
