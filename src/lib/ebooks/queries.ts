import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { uuids } from "@/lib/catalogue/work-store";
import { formatRank } from "./formats";

/*
 * The e-book catalogue, read (SLN-490). An e-book is a digital copy once
 * linked: its edition and work come through the copy (ebooks.instance_id →
 * instances.edition_id → editions.work_id). A copy that was deaccessioned no
 * longer gives its work an e-book.
 */

export interface EbookFile {
  id: string;
  format: string;
  sizeBytes: number;
  status: string;
  drm: string | null;
}

export interface EbookRow {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  language: string | null;
  matchState: "pending" | "linked" | "standalone" | "excluded";
  instanceId: string | null;
  preferredFileId: string | null;
  coverKey: string | null;
  /** In FORMAT_PREFERENCE order */
  files: EbookFile[];
}

const EBOOK_COLUMNS = sql`eb.id, eb.title, eb.subtitle, eb.authors, eb.language,
  eb.match_state as "matchState", eb.instance_id as "instanceId",
  eb.preferred_file_id as "preferredFileId", eb.cover_key as "coverKey",
  coalesce((select json_agg(json_build_object('id', f.id, 'format', f.format, 'sizeBytes', f.size_bytes,
    'status', f.status, 'drm', f.drm) order by f.created_at, f.id)
    from ebook_files f where f.ebook_id = eb.id), '[]'::json) as files`;

function withSortedFiles(row: EbookRow): EbookRow {
  return { ...row, files: [...row.files].sort((a, b) => formatRank(a.format) - formatRank(b.format)) };
}

/** One e-book with its files */
export async function getEbook(id: string): Promise<EbookRow | null> {
  const [row] = resultRows<EbookRow>(
    await db.execute(sql`select ${EBOOK_COLUMNS} from ebooks eb where eb.id = ${id}::uuid`),
  );
  return row ? withSortedFiles(row) : null;
}

/** The e-books linked to the active copies of a work's editions, with their files */
export async function getEbooksForWork(workId: string): Promise<EbookRow[]> {
  const rows = resultRows<EbookRow>(
    await db.execute(sql`select ${EBOOK_COLUMNS}
      from ebooks eb
      join instances i on i.id = eb.instance_id
      join editions e on e.id = i.edition_id
      where e.work_id = ${workId}::uuid and i.status <> 'deaccessioned'
      order by lower(eb.title), eb.id`),
  );
  return rows.map(withSortedFiles);
}

/**
 * The works of this list that have an e-book: one linked to an active copy of
 * one of their editions. One query for the whole page, never one per card.
 */
export async function getWorkIdsWithEbooks(workIds: string[]): Promise<Set<string>> {
  if (!workIds.length) return new Set();
  const rows = resultRows<{ workId: string }>(
    await db.execute(sql`select distinct e.work_id as "workId"
      from ebooks eb
      join instances i on i.id = eb.instance_id
      join editions e on e.id = i.edition_id
      where e.work_id in (${uuids(workIds)}) and i.status <> 'deaccessioned'`),
  );
  return new Set(rows.map((r) => r.workId));
}

export interface RecentlyOpened {
  ebookId: string;
  title: string;
  authors: string[];
  fileId: string;
  /** 0 to 100, two decimals */
  percent: number;
  chapter: string | null;
  deviceLabel: string;
  updatedAt: Date;
}

/**
 * The newest place of each e-book across devices, newest first, without the
 * excluded e-books. Empty until the reader writes places (sub-issue 3).
 */
export async function getRecentlyOpened(limit = 10): Promise<RecentlyOpened[]> {
  const rows = resultRows<Omit<RecentlyOpened, "updatedAt"> & { updatedAt: string | Date }>(
    await db.execute(sql`select * from (
        select distinct on (p.ebook_id) p.ebook_id as "ebookId", eb.title, eb.authors, p.file_id as "fileId",
          round((p.progression * 100)::numeric, 2)::float8 as percent, p.chapter,
          p.device_label as "deviceLabel", p.updated_at as "updatedAt"
        from ebook_positions p join ebooks eb on eb.id = p.ebook_id
        where eb.match_state <> 'excluded'
        order by p.ebook_id, p.updated_at desc, p.id
      ) latest
      order by "updatedAt" desc, "ebookId"
      limit ${Math.max(1, Math.min(100, Math.floor(limit)))}`),
  );
  return rows.map((r) => ({ ...r, percent: Number(r.percent), updatedAt: new Date(r.updatedAt) }));
}
