"use server";

import { z } from "zod";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import {
  workCardExtras,
  workCardWith,
} from "@/lib/actions/utils/work-card-query";

/** Why a work counts as similar: one row per shared source. */
export interface SimilarityReason {
  kind:
    | "collection"
    | "subject"
    | "theme"
    | "movement"
    | "series"
    | "recommender"
    | "author"
    | "translator"
    | "publisher";
  id: string;
  name: string;
}

function rows<T>(result: unknown): T[] {
  return Array.isArray(result) ? result : (result as { rows: T[] }).rows;
}

/**
 * Explicit catalogue evidence only, independent of reading predictions and
 * sourced work relations. Each distinct (book, kind, source) contributes
 * baseWeight / sourceSize; size counts distinct books, including the target.
 * Series weighs 2 (a direct continuation); collections, subjects, themes,
 * movements and authors 1; translators and recommenders .75; publishers .25
 * (a broad publishing affinity). Several kinds add their weights together.
 * Only sources on the target are expanded; card data is fetched after LIMIT.
 * Ties retain collection member order, then title and UUID. Reasons put the
 * strongest evidence first, with stable kind/name/UUID ties.
 */
export async function getSimilarWorks(workId: string, limit = 12) {
  z.string().uuid().parse(workId);
  z.number().int().min(1).max(50).parse(limit);
  const ranked = rows<{ workId: string; reasons: SimilarityReason[] }>(
    await db.execute(sql`
      with target as (
        select id from works where id = ${workId}::uuid and kind = 'book'
      ), held as (
        select ce.collection_id, e.work_id, ce.sort_order, ce.added_at
        from collection_editions ce join editions e on e.id = ce.edition_id
        union all
        select cw.collection_id, cw.work_id, cw.sort_order, cw.added_at
        from collection_works cw join works w on w.id = cw.work_id and w.kind = 'book'
      ), collection_members as (
        select collection_id, work_id,
          min(sort_order) as position, min(added_at) as added_at
        from held
        where collection_id in (
          select collection_id from held join target t on t.id = held.work_id
        )
        group by collection_id, work_id
      ), raw_signals as (
        select m.work_id, 'collection' as kind, c.id as source_id,
          c.name as source_name, 1.0 as base_weight,
          row_number() over (
            order by c.sort_order, c.name, c.id, m.position, m.added_at, m.work_id
          ) as ord
        from collection_members m join collections c on c.id = m.collection_id
        union all
        select m.work_id, 'subject', s.id, s.name, 1.0, null::bigint
        from work_subjects m join subjects s on s.id = m.subject_id
        where m.subject_id in (select subject_id from work_subjects join target t on t.id = work_id)
        union all
        select m.work_id, 'theme', s.id, s.name, 1.0, null::bigint
        from work_themes m join themes s on s.id = m.theme_id
        where m.theme_id in (select theme_id from work_themes join target t on t.id = work_id)
        union all
        select m.work_id, 'movement', s.id, s.name, 1.0, null::bigint
        from work_literary_movements m join literary_movements s on s.id = m.literary_movement_id
        where m.literary_movement_id in (select literary_movement_id from work_literary_movements join target t on t.id = work_id)
        union all
        select w.id, 'series', s.id, s.title, 2.0, null::bigint
        from works w join series s on s.id = w.series_id
        where w.series_id in (select series_id from works join target t on t.id = works.id)
        union all
        select m.work_id, 'recommender', s.id, s.name, 0.75, null::bigint
        from work_recommenders m join recommenders s on s.id = m.recommender_id
        where m.recommender_id in (select recommender_id from work_recommenders join target t on t.id = work_id)
        union all
        select m.work_id, 'author', s.id, s.name, 1.0, null::bigint
        from work_authors m join authors s on s.id = m.author_id
        where m.role in ('author', 'co_author') and m.author_id in (
          select author_id from work_authors join target t on t.id = work_id
          where role in ('author', 'co_author')
        )
        union all
        select e.work_id, 'translator', s.id, s.name, 0.75, null::bigint
        from edition_contributors m join editions e on e.id = m.edition_id
        join authors s on s.id = m.author_id
        where m.role = 'translator' and m.author_id in (
          select author_id from edition_contributors x join editions e on e.id = x.edition_id
          join target t on t.id = e.work_id where x.role = 'translator'
        )
        union all
        select e.work_id, 'publisher', s.id, s.name, 0.25, null::bigint
        from edition_publishers m join editions e on e.id = m.edition_id
        join publishing_houses s on s.id = m.publisher_id
        where m.publisher_id in (
          select publisher_id from edition_publishers x join editions e on e.id = x.edition_id
          join target t on t.id = e.work_id
        )
      ), members as (
        -- Multiple editions or credits never multiply a book's contribution.
        select r.work_id, r.kind, r.source_id, r.source_name, r.base_weight, min(r.ord) as ord
        from raw_signals r join works w on w.id = r.work_id and w.kind = 'book'
        group by r.work_id, r.kind, r.source_id, r.source_name, r.base_weight
      ), signals as (
        select *, base_weight / count(*) over (partition by kind, source_id) as weight
        from members
      )
      select s.work_id as "workId",
        jsonb_agg(
          jsonb_build_object('kind', s.kind, 'id', source_id, 'name', source_name)
          order by weight desc, s.kind collate "C", source_name collate "C", source_id
        ) as reasons
      from signals s join works w on w.id = s.work_id
      where s.work_id <> ${workId}::uuid
      group by s.work_id, w.title
      order by sum(weight) desc, min(ord) nulls last, w.title collate "C", s.work_id
      limit ${limit}
    `),
  );
  if (!ranked.length) return [];

  const found = await db.query.works.findMany({
    where: inArray(
      works.id,
      ranked.map((r) => r.workId),
    ),
    extras: workCardExtras,
    with: workCardWith,
  });
  const byId = new Map(found.map((w) => [w.id, w]));
  return ranked.flatMap(({ workId: id, reasons }) => {
    const work = byId.get(id);
    return work ? [{ ...work, reasons }] : [];
  });
}
