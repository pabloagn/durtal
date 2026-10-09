"use server";

import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
import { resultRows } from "@/lib/harmonization/store";
import { loadRelatedBooks } from "@/lib/catalogue/related-books";
import {
  loadRelatedTiles,
  type SimilarWork,
} from "@/lib/catalogue/related-tiles";
import type { WorkKind } from "@/lib/catalogue/kinds";

/**
 * Similarity requires two exact shared semantic items. A shared hierarchy
 * chain counts only its most specific shared item; no parent is inferred.
 * Each item contributes 1 / distinct enabled-work frequency (.75 for a
 * movement), capped at the family's weight. Original exact years add at most
 * 10% to eligible content scores. Collections and personal/credit/publishing
 * associations are deliberately absent, including from tie-breaking.
 */
export async function getSimilarWorks(
  workId: string,
  limit = 12,
): Promise<SimilarWork[]> {
  z.uuid().parse(workId);
  z.number().int().min(1).max(50).parse(limit);
  const enabled = sql.join(
    getEnabledWorkKinds().map((kind) => sql`${kind}`),
    sql`, `,
  );
  const ranked = resultRows<{ id: string; kind: WorkKind }>(
    await db.execute(sql`
    with recursive target as (
      select id from works where id=${workId}::uuid and kind in (${enabled})
    ), vocab as (
      select 'subjects' as family, id, null::uuid as parent_id, 1.0 as base_weight from subjects
      union all select 'themes', id, parent_id, 1.0 from themes
      union all select 'keywords', id, null::uuid, 1.0 from keywords
      union all select 'literary_movements', id, parent_id, .75 from literary_movements
      union all select 'art_movements', id, null::uuid, .75 from art_movements
    ), raw_target_items as (
      select 'subjects' as family, subject_id as item_id from work_subjects where work_id in (select id from target)
      union all select 'themes', theme_id from work_themes where work_id in (select id from target)
      union all select 'keywords', keyword_id from work_keywords where work_id in (select id from target)
      union all select 'literary_movements', literary_movement_id from work_literary_movements where work_id in (select id from target)
      union all select 'art_movements', art_movement_id from work_art_movements where work_id in (select id from target)
    ), target_items as (
      select t.* from raw_target_items t
      join taxonomy_families f on f.is_system and f.system_table=t.family
      join works w on w.id=${workId}::uuid
      join taxonomy_applicability a on a.family_id=f.id and a.kind=w.kind and a.level='work'
    ), ancestors(family, item_id, ancestor_id) as (
      select v.family, v.id, v.parent_id from vocab v join target_items t on t.family=v.family and t.item_id=v.id where v.parent_id is not null
      union
      select a.family, a.item_id, v.parent_id from ancestors a join vocab v on v.family=a.family and v.id=a.ancestor_id where v.parent_id is not null
    ), raw_members as (
      select 'subjects' as family, subject_id as item_id, work_id from work_subjects where subject_id in (select item_id from target_items where family='subjects')
      union all select 'themes', theme_id, work_id from work_themes where theme_id in (select item_id from target_items where family='themes')
      union all select 'keywords', keyword_id, work_id from work_keywords where keyword_id in (select item_id from target_items where family='keywords')
      union all select 'literary_movements', literary_movement_id, work_id from work_literary_movements where literary_movement_id in (select item_id from target_items where family='literary_movements')
      union all select 'art_movements', art_movement_id, work_id from work_art_movements where art_movement_id in (select item_id from target_items where family='art_movements')
    ), members as (
      select distinct m.family, m.item_id, m.work_id, v.base_weight
      from raw_members m join works w on w.id=m.work_id and w.kind in (${enabled})
      join vocab v on v.family=m.family and v.id=m.item_id
      join taxonomy_families f on f.is_system and f.system_table=m.family
      join taxonomy_applicability a on a.family_id=f.id and a.kind=w.kind and a.level='work'
    ), weighted as (
      select *, base_weight / count(*) over(partition by family,item_id) as weight from members
    ), retained as (
      select m.* from weighted m where not exists (
        select 1 from ancestors a join members child on child.family=a.family and child.item_id=a.item_id and child.work_id=m.work_id
        where a.family=m.family and a.ancestor_id=m.item_id
      )
    ), family_scores as (
      select work_id,family,least(max(base_weight),sum(weight)) as score,count(*) as items
      from retained where work_id<>${workId}::uuid group by work_id,family
    ), eligible as (
      select work_id,sum(score) as content_score,count(*) as families
      from family_scores group by work_id having sum(items)>=2
    ), years as (
      select w.id, case when w.kind='book' then w.original_year
        when d.precision in ('year','month','day') and not d.approximate and d.end_year is null then d.start_year end as year
      from works w
      left join film_details f on f.work_id=w.id and w.kind='film'
      left join perfume_details p on p.work_id=w.id and w.kind='perfume'
      left join painting_details a on a.work_id=w.id and w.kind='painting'
      left join catalogue_dates d on d.id=coalesce(f.release_date_id,p.release_date_id,a.creation_date_id)
      where w.id=${workId}::uuid or w.id in (select work_id from eligible)
    )
    select w.id,w.kind from eligible e join works w on w.id=e.work_id
    join years y on y.id=w.id cross join years t
    where t.id=${workId}::uuid
    order by e.content_score * (1 + case when y.year is not null and t.year is not null
      then .10 / (1 + abs(y.year::numeric-t.year::numeric)/10) else 0 end) desc,
      e.families desc,w.title collate "C",w.id
    limit ${limit}
  `),
  );
  if (!ranked.length) return [];
  const [books, tiles] = await Promise.all([
    loadRelatedBooks(
      ranked
        .filter((row) => row.kind === "book")
        .map((row) => ({ workId: row.id })),
    ),
    loadRelatedTiles(
      ranked.filter((row) => row.kind !== "book").map((row) => row.id),
    ),
  ]);
  return ranked.flatMap(({ id, kind }): SimilarWork[] => {
    if (kind === "book") {
      const book = books.books.get(id);
      return book ? [{ id, title: book.title, kind, book }] : [];
    }
    const tile = tiles.get(id);
    return tile ? [{ id, title: tile.title, kind, tile }] : [];
  });
}
