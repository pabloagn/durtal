import { sql, type SQL } from "drizzle-orm";
import { ownedBookCondition } from "@/lib/catalogue/holdings";
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
  if (filters.reading?.length)
    out.push(sql`${readingStateSql(workId)} in (${sql.join(filters.reading.map((r) => sql`${r}`), sql`, `)})`);
  if (filters.holding === "owned") out.push(ownedBookCondition(workId));
  if (filters.holding === "not_owned") out.push(sql`not ${ownedBookCondition(workId)}`);
  if (filters.readFrom !== undefined || filters.readTo !== undefined) out.push(readInCondition(workId, filters.readFrom, filters.readTo));
  if (filters.reread) out.push(sql`${readCountSql(workId)} >= 2`);
  return out;
}
