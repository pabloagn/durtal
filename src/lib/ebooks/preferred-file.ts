import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { ebookFileNativeReadableCondition } from "./conditions";
import { preferredEbookFileSchema } from "@/lib/validations/ebooks";
type Database = { execute(query: SQL): PromiseLike<unknown> };
/** Locks the same-book ebook and file before changing the preference, including current capability. */
export async function setPreferredFile(
  input: unknown,
  database: Database = db,
) {
  const { ebookId, fileId } = preferredEbookFileSchema.parse(input);
  const native = ebookFileNativeReadableCondition({
    status: sql`f.status`,
    drm: sql`f.drm`,
    s3Key: sql`f.s3_key`,
    sha256: sql`f.sha256`,
    sizeBytes: sql`f.size_bytes`,
    format: sql`f.format`,
    metadata: sql`f.metadata`,
    manifestKey: sql`f.manifest_key`,
  });
  const [row] = resultRows<{ id: string; preferredFileId: string }>(
    await database.execute(sql`with target as (
    select e.id, f.id as file_id from ebooks e join ebook_files f on f.ebook_id = e.id
    where e.id = ${ebookId}::uuid and f.id = ${fileId}::uuid and e.match_state <> 'excluded' and ${native}
    for update of e, f
  ) update ebooks e set preferred_file_id = target.file_id, updated_at = now()
    from target where e.id = target.id returning e.id, e.preferred_file_id as "preferredFileId"`),
  );
  if (!row)
    throw new Error(
      "This file can no longer be opened. Reload the eBook and choose a readable format.",
    );
  return row;
}
