/**
 * The pages of a book (SLN-466). One rule says which editions count for a
 * work, and every page reader builds on it: the filter condition, the unknown
 * condition and the per-work read. The rule is written in
 * docs/02_DATA_MODEL.md, "Pages of a Work". Nothing here writes `page_count`.
 */
import { and, inArray, sql, type SQL } from "drizzle-orm";
import { alias, type PgDatabase, type PgQueryResultHKT } from "drizzle-orm/pg-core";
import { editions, works } from "@/lib/db/schema";
import { ownedBookCondition } from "@/lib/catalogue/holdings";
import { MAX_PAGES, MIN_PAGES } from "@/lib/books/enrichment";

export interface PageOptions {
  /** Count only the editions with an available copy at this location */
  locationId?: string;
}

export interface WorkPages {
  /** The range of usable counts; null when the pages are unknown */
  min: number | null;
  max: number | null;
  basis: "owned" | "location" | "any_edition";
  /** The counted editions with a usable count */
  editions: { id: string; pageCount: number; metadataSource: string | null }[];
}

// The edition a page rule reads is named pe, so the owned rule's own e and i stay apart
const pe = alias(editions, "pe");

/**
 * The building block: edition pe counts for its work. At a location, it has
 * an available copy there. Otherwise, for an owned work it has a copy that
 * is not deaccessioned, and for a work not owned every edition counts.
 */
function countedEdition({ locationId }: PageOptions): SQL {
  if (locationId)
    return sql`exists (select 1 from instances i where i.edition_id = pe.id and i.status = 'available' and i.location_id = ${locationId})`;
  return sql`(not ${ownedBookCondition(sql`pe.work_id`)} or exists (select 1 from instances i where i.edition_id = pe.id and i.status <> 'deaccessioned'))`;
}

/** Edition pe has a usable count, inside [min, max] when they are given */
function usableCount(min?: number, max?: number): SQL {
  const bounds = [sql`pe.page_count between ${MIN_PAGES} and ${MAX_PAGES}`];
  if (min !== undefined) bounds.push(sql`pe.page_count >= ${min}`);
  if (max !== undefined) bounds.push(sql`pe.page_count <= ${max}`);
  return sql.join(bounds, sql` and `);
}

/** The work has an available copy at the location: the location rule speaks only of these works */
function atLocation(workId: SQL | unknown, locationId: string): SQL {
  return sql`exists (select 1 from editions e join instances i on i.edition_id = e.id
    where e.work_id = ${workId} and i.status = 'available' and i.location_id = ${locationId})`;
}

/** A work matches when one of its counted editions has a usable count inside [min, max] */
export function pageRangeCondition({ min, max, locationId }: PageOptions & { min?: number; max?: number }): SQL {
  return sql`exists (select 1 from editions pe where pe.work_id = ${works.id}
    and ${countedEdition({ locationId })} and ${usableCount(min, max)})`;
}

/** No counted edition of the work has a usable count. Unknown is never short */
export function pagesUnknownCondition({ locationId }: PageOptions): SQL {
  const unknown = sql`not exists (select 1 from editions pe where pe.work_id = ${works.id}
    and ${countedEdition({ locationId })} and ${usableCount()})`;
  return locationId ? sql`(${atLocation(works.id, locationId)} and ${unknown})` : unknown;
}

/**
 * The pages of each work, keyed by work id. At a location, a work with no
 * available copy there has no entry.
 */
export async function getWorkPages(
  database: PgDatabase<PgQueryResultHKT>,
  workIds: string[],
  { locationId }: PageOptions = {},
): Promise<Map<string, WorkPages>> {
  const pages = new Map<string, WorkPages>();
  if (!workIds.length) return pages;
  // In a select list drizzle leaves columns unqualified, so the work id is named in full
  const workId = sql`works.id`;
  const bases = await database
    .select({
      id: works.id,
      owned: ownedBookCondition(workId),
      present: locationId ? atLocation(workId, locationId).mapWith(Boolean) : sql<boolean>`true`,
    })
    .from(works)
    .where(inArray(works.id, workIds));
  for (const work of bases) {
    if (!work.present) continue;
    const basis = locationId ? "location" : work.owned ? "owned" : "any_edition";
    pages.set(work.id, { min: null, max: null, basis, editions: [] });
  }
  const counted = await database
    .select({ workId: pe.workId, id: pe.id, pageCount: pe.pageCount, metadataSource: pe.metadataSource })
    .from(pe)
    .where(and(inArray(pe.workId, workIds), countedEdition({ locationId }), usableCount()))
    .orderBy(pe.pageCount, pe.id);
  for (const edition of counted) {
    const work = pages.get(edition.workId)!;
    const pageCount = edition.pageCount!;
    work.editions.push({ id: edition.id, pageCount, metadataSource: edition.metadataSource });
    work.min = Math.min(work.min ?? pageCount, pageCount);
    work.max = Math.max(work.max ?? pageCount, pageCount);
  }
  return pages;
}
