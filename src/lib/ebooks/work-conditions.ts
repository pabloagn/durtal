import { sql, type SQL } from "drizzle-orm";
import { ebookFileNativeReadableCondition } from "./conditions";

/** Same eligibility for list/count/timeline/API filters and the cover mark. */
export function workHasReadableEbookCondition(workId: SQL | unknown): SQL {
  return sql`exists (select 1 from editions ebook_edition
    join instances ebook_copy on ebook_copy.edition_id = ebook_edition.id and ebook_copy.status <> 'deaccessioned'
    join ebooks ebook_book on ebook_book.instance_id = ebook_copy.id and ebook_book.match_state = 'linked'
    join ebook_files ebook_file on ebook_file.ebook_id = ebook_book.id
    where ebook_edition.work_id = ${workId} and ${ebookFileNativeReadableCondition({
      status: sql`ebook_file.status`, drm: sql`ebook_file.drm`, s3Key: sql`ebook_file.s3_key`,
      sha256: sql`ebook_file.sha256`, sizeBytes: sql`ebook_file.size_bytes`, format: sql`ebook_file.format`,
      metadata: sql`ebook_file.metadata`, manifestKey: sql`ebook_file.manifest_key`,
    })})`;
}
