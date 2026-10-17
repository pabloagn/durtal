import { sql } from "drizzle-orm";
import { readingOrdinalSql, rereadSql } from "./summary";

/**
 * Narrow all-history facts for statistics and the journal. The full-partition
 * finished count replaces a correlated count for each unrated reading. Keep
 * these windows before period, status, search or pagination filters: a single
 * finished reading in the selected year need not be its book's only finish.
 * Bodies, review JSON and mutation fingerprints belong to selected rows only.
 */
export function readingFactsSql() {
  return sql`(
    select f.*, coalesce(f.rating::float8,
      case when f.status = 'finished' and f.finished_count = 1 then w.rating::float8 end) as read_rating
    from (
      select r.id, r.work_id, r.edition_id, r.instance_id, r.location_id,
        r.status, r.format, r.started_on, r.started_precision, r.finished_on, r.finished_precision,
        r.total_pages, r.last_read_at, r.created_at, r.source_key, r.rating,
        count(*) filter (where r.status = 'finished') over (partition by r.work_id)::int as finished_count,
        ${readingOrdinalSql("r")} as ordinal, ${rereadSql("r")} as reread
      from readings r
    ) f join works w on w.id = f.work_id
  )`;
}
