"use server";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/series/work-series";
import { getPublisherOptions } from "@/lib/actions/publishers";
import { getReadYearRange } from "@/lib/actions/reading";
import { BOOK_TAXONOMY_TABLES, coverColorSql } from "@/lib/library/filter-conditions";
import { BOOK_TAXONOMY_FILTERS, type BookTaxonomyKey } from "@/lib/library/filter-params";
import { languageName } from "@/lib/utils/language";
import type { ColorBucket } from "@/lib/color/color-buckets";

export interface CountedOption {
  value: string;
  label: string;
  /** Books with it */
  count: number;
}

/** Items of one book taxonomy that books use, with the broader items of those, each with its books */
async function taxonomyOptions(key: BookTaxonomyKey): Promise<CountedOption[]> {
  const t = BOOK_TAXONOMY_TABLES[key];
  const [join, column, items] = [sql.identifier(t.join), sql.identifier(t.column), sql.identifier(t.items)];
  const rows = t.hierarchical
    ? resultRows<{ id: string; name: string; parentName: string | null; count: number }>(
        await db.execute(sql`with recursive used(work_id, item_id) as (
            select j.work_id, j.${column} from ${join} j join works w on w.id = j.work_id and w.kind = 'book'
          ), broader(work_id, item_id) as (
            select work_id, item_id from used
            union select b.work_id, i.parent_id from broader b join ${items} i on i.id = b.item_id where i.parent_id is not null
          )
          select i.id, i.name, p.name as "parentName", count(distinct b.work_id)::int as count
          from broader b join ${items} i on i.id = b.item_id left join ${items} p on p.id = i.parent_id
          group by i.id, i.name, p.name`),
      )
    : resultRows<{ id: string; name: string; parentName: null; count: number }>(
        await db.execute(sql`select i.id, i.name, null as "parentName", count(distinct j.work_id)::int as count
          from ${join} j join works w on w.id = j.work_id and w.kind = 'book' join ${items} i on i.id = j.${column}
          group by i.id, i.name`),
      );
  return rows
    .map((r) => ({ value: r.id, label: r.parentName ? `${r.parentName} › ${r.name}` : r.name, count: r.count }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || a.value.localeCompare(b.value));
}

const byLabel = (a: CountedOption, b: CountedOption) =>
  a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || a.value.localeCompare(b.value);

/**
 * The values the library can filter by (SLN-405), each with how many books
 * have it: what the books, their editions and their held copies use, so no
 * option finds nothing. Loaded when the filter panel is about to open, or at
 * once when a filter that needs a name (a place, a subject) is in the URL.
 */
export async function getLibraryFilterOptions() {
  const [publishers, readYears, languages, originalLanguages, [years], locations, formats, [copies], colors, ...taxonomy] =
    await Promise.all([
      getPublisherOptions(),
      getReadYearRange(),
      db.execute(sql`select e.language as code, count(distinct e.work_id)::int as count
        from editions e join works w on w.id = e.work_id and w.kind = 'book' group by e.language`),
      db.execute(sql`select w.original_language as code, count(*)::int as count
        from works w where w.kind = 'book' and w.original_language is not null group by w.original_language`),
      db.execute(sql`select min(original_year)::int as min, max(original_year)::int as max from works where kind = 'book'`).then(
        (r) => resultRows<{ min: number | null; max: number | null }>(r),
      ),
      db.execute(sql`select l.id, l.name, count(distinct e.work_id)::int as count
        from locations l join instances i on i.location_id = l.id and i.status <> 'deaccessioned'
        join editions e on e.id = i.edition_id join works w on w.id = e.work_id and w.kind = 'book'
        group by l.id, l.name`),
      db.execute(sql`select i.format, count(distinct e.work_id)::int as count
        from instances i join editions e on e.id = i.edition_id join works w on w.id = e.work_id and w.kind = 'book'
        where i.status <> 'deaccessioned' and i.format is not null group by i.format`),
      db.execute(sql`select count(distinct e.work_id) filter (where i.is_signed)::int as signed,
          count(distinct e.work_id) filter (where i.is_first_printing)::int as first
        from instances i join editions e on e.id = i.edition_id join works w on w.id = e.work_id and w.kind = 'book'
        where i.status <> 'deaccessioned'`).then((r) => resultRows<{ signed: number; first: number }>(r)),
      db.execute(sql`select c.color, count(*)::int as count
        from (select ${coverColorSql(sql`w.id`)} as color from works w where w.kind = 'book') c
        where c.color is not null group by c.color`),
      ...BOOK_TAXONOMY_FILTERS.map((f) => taxonomyOptions(f.key)),
    ]);

  const named = (rows: unknown) =>
    resultRows<{ code: string; count: number }>(rows)
      .map((r) => ({ value: r.code, label: languageName(r.code) ?? r.code, count: r.count }))
      .sort(byLabel);

  return {
    publishers,
    readYears,
    languages: named(languages),
    originalLanguages: named(originalLanguages),
    years: years?.min != null && years.max != null ? { min: years.min, max: years.max } : null,
    locations: resultRows<{ id: string; name: string; count: number }>(locations)
      .map((r) => ({ value: r.id, label: r.name, count: r.count }))
      .sort(byLabel),
    formats: Object.fromEntries(
      resultRows<{ format: string; count: number }>(formats).map((r) => [r.format, r.count]),
    ) as Record<string, number>,
    copies: { signed: copies?.signed ?? 0, first: copies?.first ?? 0 },
    colors: Object.fromEntries(
      resultRows<{ color: ColorBucket; count: number }>(colors).map((r) => [r.color, r.count]),
    ) as Partial<Record<ColorBucket, number>>,
    taxonomy: Object.fromEntries(BOOK_TAXONOMY_FILTERS.map((f, i) => [f.key, taxonomy[i]])) as Record<
      BookTaxonomyKey,
      CountedOption[]
    >,
  };
}
export type LibraryFilterOptions = Awaited<ReturnType<typeof getLibraryFilterOptions>>;
