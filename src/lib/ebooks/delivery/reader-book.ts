import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { formatRank, READABLE_FORMATS } from "../formats";
import { medallionOf } from "../medallion";
import { isDeliverable, type CatalogueFile } from "./files";

/*
 * What the reader page needs, in one query (eBooks sub-issue 3): the
 * e-book, its readable files (stored or verified, no DRM, a format the
 * reader opens), the linked book's page and this device's saved places.
 * Like the readers in files.ts, it is the only other place that makes
 * CatalogueFiles: the rows were read in this request.
 */

export interface ReaderFile extends CatalogueFile {
  readonly manifestKey: string | null;
}

export interface ReaderPlace {
  fileId: string;
  locator: Record<string, unknown>;
  clientUpdatedAt: string;
}

export interface ReaderBook {
  id: string;
  title: string;
  authors: string[];
  language: string | null;
  /** The linked book's page, while its copy is held */
  workSlug: string | null;
  /** Readable files, in FORMAT_PREFERENCE order */
  files: ReaderFile[];
  /** The file to open: `?file=` when readable, else the preferred file, else the first */
  file: ReaderFile | null;
  /** This device's place in `file` */
  place: ReaderPlace | null;
}

type Row = Omit<ReaderBook, "file" | "place" | "files"> & {
  preferredFileId: string | null;
  files: ReaderFile[];
  places: ReaderPlace[];
};

const readable = sql.join(
  READABLE_FORMATS.map((format) => sql`${format}`),
  sql`, `,
);

/** The reader's e-book, or null when there is none */
export async function readReaderBook(
  ebookId: string,
  options: { deviceId?: string | null; fileId?: string | null } = {}): Promise<ReaderBook | null> {
  const [row] = resultRows<Row>(
    await db.execute(sql`select eb.id, eb.title, eb.authors, eb.language,
        eb.preferred_file_id as "preferredFileId", w.slug as "workSlug",
        coalesce((select json_agg(json_build_object('id', f.id, 'ebookId', f.ebook_id, 'sha256', f.sha256,
            's3Key', f.s3_key, 'format', f.format, 'sizeBytes', f.size_bytes, 'contentType', f.content_type,
            'status', f.status, 'drm', f.drm, 'metadata', f.metadata, 'manifestKey', f.manifest_key) order by f.created_at, f.id)
          from ebook_files f
          where f.ebook_id = eb.id and f.status in ('stored', 'verified') and f.drm is null
            and f.format in (${readable})), '[]'::json) as files,
        coalesce((select json_agg(json_build_object('fileId', p.file_id, 'locator', p.locator,
            'clientUpdatedAt', p.client_updated_at))
          from ebook_positions p
          where p.ebook_id = eb.id and p.device_id = ${options.deviceId ?? ""}), '[]'::json) as places
      from ebooks eb
      left join instances i on i.id = eb.instance_id and i.status <> 'deaccessioned'
      left join editions e on e.id = i.edition_id
      left join works w on w.id = e.work_id
      where eb.id = ${ebookId}::uuid`),
  );
  if (!row) return null;
  const files = row.files
    .filter((f) => isDeliverable(f) && (!medallionOf(f.metadata) || medallionOf(f.metadata)!.validation.nativeReadable))
    .sort((a, b) => formatRank(a.format) - formatRank(b.format));
  const byId = (id: string | null | undefined) => (id ? files.find((f) => f.id === id.toLowerCase()) : undefined);
  const file = byId(options.fileId) ?? byId(row.preferredFileId) ?? files[0] ?? null;
  const place = file ? (row.places.find((p) => p.fileId === file.id) ?? null) : null;
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    language: row.language,
    workSlug: row.workSlug,
    files,
    file,
    place,
  };
}
