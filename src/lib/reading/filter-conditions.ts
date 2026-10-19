import { sql, type SQL } from "drizzle-orm";
import { ownedWorkCondition } from "@/lib/catalogue/holdings";
import { catalogueStatusCondition } from "@/lib/publishers/conditions";
import { readCountSql, readInCondition, readingStateSql } from "./summary";
import type { ReadingFilterParams } from "./filter-params";

/**
 * The library's reading, holding and status conditions over a work id column
 * (SLN-449), for the list, its count, the timeline and `GET /api/works`.
 */
export function readingFilterConditions(workId: SQL | unknown, filters: ReadingFilterParams | undefined): SQL[] {
  const out: SQL[] = [];
  if (!filters) return out;
  if (filters.catalogueStatus?.length) out.push(catalogueStatusCondition(filters.catalogueStatus));
  if (filters.reading?.length) {
    // Any one of the values: a reading state, or in Up next (SLN-452)
    const states = filters.reading.filter((r) => r !== "queued");
    const any = [
      ...(states.length ? [sql`${readingStateSql(workId)} in (${sql.join(states.map((r) => sql`${r}`), sql`, `)})`] : []),
      ...(filters.reading.includes("queued") ? [sql`exists (select 1 from reading_queue q where q.work_id = ${workId})`] : []),
    ];
    out.push(any.length === 1 ? any[0] : sql`(${sql.join(any, sql` or `)})`);
  }
  if (filters.holding === "owned") out.push(ownedWorkCondition(workId));
  if (filters.holding === "not_owned") out.push(sql`not ${ownedWorkCondition(workId)}`);
  // A copy out on loan (SLN-1125)
  if (filters.holding === "lent_out")
    out.push(sql`exists (select 1 from editions e join instances i on i.edition_id = e.id where e.work_id = ${workId} and i.status = 'lent_out')`);
  if (filters.readFrom !== undefined || filters.readTo !== undefined) out.push(readInCondition(workId, filters.readFrom, filters.readTo));
  if (filters.reread) out.push(sql`${readCountSql(workId)} >= 2`);
  return out;
}
