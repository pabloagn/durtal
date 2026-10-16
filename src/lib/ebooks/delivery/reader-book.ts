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
 * reader opens), the linked book's page, this device's history, and each
 * other device's newest place and the furthest one (SLN-665).
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
  /** Each other device's newest place and the furthest, newest first: the offer's newest and furthest (SLN-686, SLN-665) */
  otherPlaces: ReaderPlace[];
  /** The newest place of the device `from` names, which the book opens at (SLN-665) */
  startPlace: ReaderPlace | null;
  /** With no readable file, a file DRM locks, which the reader names (SLN-685) */
  locked: { fileId: string; drm: string } | null;
}

type Row = Omit<
  ReaderBook,
  "file" | "place" | "devicePlace" | "otherPlace" | "otherPlaces" | "startPlace" | "files" | "locked"
> & {
  preferredFileId: string | null;
  matchState: string;
  files: ReaderFile[];
  places: ReaderPlace[];
};

/** The reader's e-book, or null when there is none */
export async function readReaderBook(
  ebookId: string,
  options: { deviceId?: string | null; fileId?: string | null; fromDeviceId?: string | null } = {},
): Promise<ReaderBook | null> {
  // However many places the book has (SLN-665): this device's and the chosen
  // device's, each other device's newest, and the furthest other one
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
          where p.ebook_id = eb.id and (p.device_id in (${options.deviceId ?? ""}, ${options.fromDeviceId ?? ""})
            or p.id in (select distinct on (o.device_label) o.id from ebook_positions o where o.ebook_id = eb.id
              order by o.device_label, o.client_updated_at desc, o.device_id, o.file_id)
            or p.id = (select o.id from ebook_positions o where o.ebook_id = eb.id and o.device_id <> ${options.deviceId ?? ""}
              order by (o.locator->>'totalProgression')::float8 desc nulls last, o.client_updated_at desc limit 1))), '[]'::json) as places
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
  const startPlace = options.fromDeviceId
    ? (places.find((p) => p.deviceId === options.fromDeviceId) ?? null)
    : null;
  const file = byId(options.fileId) ?? byId(startPlace?.fileId) ?? byId(continuation?.target.id) ?? null;
  const place = file
    ? (places.find((p) => p.thisDevice && p.fileId === file.id) ?? null)
    : null;
  const lockedFile = files.length || row.matchState === "excluded" ? undefined
    : row.files.find((f) => f.drm !== null && (f.status === "stored" || f.status === "verified"));
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
    startPlace,
    locked: lockedFile?.drm ? { fileId: lockedFile.id, drm: lockedFile.drm } : null,
  };
}
