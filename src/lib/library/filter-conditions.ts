import { gte, inArray, isNotNull, isNull, lte, or, and, sql, type SQL } from "drizzle-orm";
import { works } from "@/lib/db/schema";
import { publisherWorkCondition } from "@/lib/publishers/conditions";
import { marksCondition } from "@/lib/actions/utils/work-marks";
import type { BookFilterParams, BookTaxonomyKey, CopyFlag } from "./filter-params";

/**
 * The tables behind each book taxonomy filter. A hierarchical one matches
 * the chosen items and every item below them.
 */
const TAXONOMY_TABLES: Record<BookTaxonomyKey, { join: string; column: string; items: string; hierarchical: boolean }> = {
  subject: { join: "work_subjects", column: "subject_id", items: "subjects", hierarchical: false },
  category: { join: "work_categories", column: "category_id", items: "book_categories", hierarchical: true },
  theme: { join: "work_themes", column: "theme_id", items: "themes", hierarchical: true },
  movement: { join: "work_literary_movements", column: "literary_movement_id", items: "literary_movements", hierarchical: true },
  artType: { join: "work_art_types", column: "art_type_id", items: "art_types", hierarchical: false },
  artMovement: { join: "work_art_movements", column: "art_movement_id", items: "art_movements", hierarchical: false },
  keyword: { join: "work_keywords", column: "keyword_id", items: "keywords", hierarchical: false },
  attribute: { join: "work_attributes", column: "attribute_id", items: "attributes", hierarchical: false },
};
export { TAXONOMY_TABLES as BOOK_TAXONOMY_TABLES };

const uuids = (values: string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::uuid[]`;
const texts = (values: string[]) => sql`(${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;

/**
 * The colour of the cover a library card shows (SLN-405): the active
 * poster's, or else the first edition's cover (oldest first, as the card's
 * `editions` relation is ordered). Null when that image has no colour yet.
 */
export function coverColorSql(workId: SQL | unknown) {
  return sql<string | null>`(case
    when exists (select 1 from media m where m.work_id = ${workId} and m.type = 'poster' and m.is_active)
    then (select m.color_bucket from media m where m.work_id = ${workId} and m.type = 'poster' and m.is_active order by m.created_at desc, m.id limit 1)
    else (select case when e.thumbnail_s3_key is not null then e.cover_color_bucket end
      from editions e where e.work_id = ${workId} order by e.created_at, e.id limit 1)
  end)`;
}

/** A held copy (not deaccessioned) of the work with every condition */
function copyCondition(workId: SQL | unknown, conditions: SQL[]) {
  return sql`exists (select 1 from editions e join instances i on i.edition_id = e.id
    where e.work_id = ${workId} and i.status <> 'deaccessioned' and ${sql.join(conditions, sql` and `)})`;
}

const COPY_FLAG_SQL: Record<CopyFlag, SQL> = {
  signed: sql`i.is_signed`,
  first: sql`i.is_first_printing`,
};

/**
 * The library's book conditions (SLN-405), with `works` in the query: for
 * the list, its count, the timeline and the colour counts. Reading, holding
 * and status are `readingFilterConditions`.
 */
export function bookFilterConditions(filters: BookFilterParams | undefined): SQL[] {
  const out: SQL[] = [];
  if (!filters) return out;
  const workId = works.id;

  const marks = marksCondition(filters.marks ?? []);
  if (marks) out.push(marks);
  if (filters.publisherIds?.length) out.push(publisherWorkCondition(filters.publisherIds));
  if (filters.acquisitionPriority?.length) out.push(inArray(works.acquisitionPriority, filters.acquisitionPriority));
  if (filters.minRating !== undefined) out.push(gte(works.rating, filters.minRating));

  // Copies: one held copy must match every chosen copy group
  const copy: SQL[] = [];
  if (filters.locationIds?.length) copy.push(sql`i.location_id = any(${uuids(filters.locationIds)})`);
  if (filters.formats?.length) copy.push(sql`i.format in ${texts(filters.formats)}`);
  for (const flag of filters.copyFlags ?? []) copy.push(COPY_FLAG_SQL[flag]);
  if (copy.length) out.push(copyCondition(workId, copy));

  if (filters.languages?.length)
    out.push(sql`exists (select 1 from editions e where e.work_id = ${workId} and e.language in ${texts(filters.languages)})`);
  if (filters.originalLanguages?.length) out.push(inArray(works.originalLanguage, filters.originalLanguages));
  if (filters.yearFrom !== undefined) out.push(gte(works.originalYear, filters.yearFrom));
  if (filters.yearTo !== undefined) out.push(lte(works.originalYear, filters.yearTo));
  if (filters.series === "in") out.push(or(isNotNull(works.seriesId), isNotNull(works.seriesName))!);
  if (filters.series === "none") out.push(and(isNull(works.seriesId), isNull(works.seriesName))!);

  for (const [key, ids] of Object.entries(filters.taxonomy ?? {}) as [BookTaxonomyKey, string[]][]) {
    if (!ids?.length) continue;
    const t = TAXONOMY_TABLES[key];
    const [join, column, items] = [sql.identifier(t.join), sql.identifier(t.column), sql.identifier(t.items)];
    const chosen = t.hierarchical
      ? sql`(with recursive d(id) as (select unnest(${uuids(ids)}) union select c.id from ${items} c join d on c.parent_id = d.id) select id from d)`
      : sql`(select unnest(${uuids(ids)}))`;
    out.push(sql`exists (select 1 from ${join} j where j.work_id = ${workId} and j.${column} in ${chosen})`);
  }

  if (filters.colors?.length) out.push(sql`${coverColorSql(workId)} in ${texts(filters.colors)}`);
  if (filters.hasPoster !== undefined) {
    const poster = sql`exists (select 1 from media m where m.work_id = ${workId} and m.type = 'poster' and m.is_active)`;
    out.push(filters.hasPoster ? poster : sql`not ${poster}`);
  }
  return out;
}
