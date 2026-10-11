import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { serverEnv } from "@/lib/env";
import { existingCopyStampForRow, EXISTING_COPY_METADATA_COLUMNS } from "@/lib/ebooks/match/existing-copy";
import { parseExistingCopyPatch } from "@/lib/ebooks/match/manual-intents";
import type { StoredRow } from "@/lib/ebooks/match/load";
import { reviewTimestampSql } from "@/lib/ebooks/review/store-sql";
import { ReviewError } from "@/lib/ebooks/review/errors";
import type { ReviewExistingCopyContext } from "./existing-copy";

export interface ReviewCopyContextInput { workId: string; editionId: string; instanceId: string }
/** One lazy editor read; stamp and initial metadata share the actual RR row.
 * Full native raw values stay server-side, before client string normalization. */
export async function loadReviewExistingCopyContext(conn: Db, input: ReviewCopyContextInput): Promise<ReviewExistingCopyContext> {
  const [value] = resultRows<{ row: StoredRow }>(await conn.execute(sql`
    select to_jsonb(i) || jsonb_build_object('updated_at', ${reviewTimestampSql(sql`i.updated_at`)}) as row
    from instances i join editions ed on ed.id=i.edition_id join works w on w.id=ed.work_id
      join locations l on l.id=i.location_id
    where i.id=${input.instanceId}::uuid and ed.id=${input.editionId}::uuid and w.id=${input.workId}::uuid
      and w.kind='book' and i.status<>'deaccessioned' and i.format in ('ebook','epub','pdf')
      and l.type='digital' and l.is_active and not ed.metadata_locked
      and not exists(select 1 from ebooks e where e.instance_id=i.id)`));
  if (!value) throw new ReviewError("ineligible_state", "The selected digital copy is unavailable.");
  const row = value.row, stamp = existingCopyStampForRow(row);
  const metadata = parseExistingCopyPatch(Object.fromEntries(Object.entries(EXISTING_COPY_METADATA_COLUMNS).map(([key, column]) => [key,
    (key === "acquisitionPrice" || key === "dispositionPrice") && typeof row[column] === "number" ? String(row[column]) : row[column]])));
  if (typeof row.location_id !== "string" || typeof row.format !== "string" || typeof row.status !== "string" ||
      !(row.sub_location_id === null || typeof row.sub_location_id === "string") ||
      !(row.file_size_bytes === null || (typeof row.file_size_bytes === "number" && Number.isSafeInteger(row.file_size_bytes))))
    throw new ReviewError("invalid_receipt", "The current copy metadata cannot be reviewed.");
  return { ...input, stamp, metadata, original: { locationId: row.location_id, subLocationId: row.sub_location_id,
    format: row.format, fileSizeBytes: row.file_size_bytes, status: row.status } };
}
export async function getReviewExistingCopyContext(input: ReviewCopyContextInput) {
  return withReadOnlyPlanningConnection(serverEnv().DATABASE_URL, (conn) => loadReviewExistingCopyContext(conn, input),
    { isolationLevel: "repeatable read" });
}
