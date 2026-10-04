"use server";

import { z } from "zod";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import { workCardWith } from "@/lib/actions/utils/work-card-query";

/** Why a work counts as similar: one row per shared source. */
export interface SimilarityReason {
  kind: "collection";
  id: string;
  name: string;
}

function rows<T>(result: unknown): T[] {
  return Array.isArray(result) ? result : (result as { rows: T[] }).rows;
}

/**
 * Works similar to a work, best first, each with the reasons it matched.
 *
 * Every signal adds one row per (similar work, shared source) to `signals`.
 * Collections are the first signal: two books in the same collection are
 * similar. A book is in a collection through its editions or as a whole
 * book (SLN-362); either way it counts once per collection. Other kinds of
 * work in a collection are not books and are left out.
 *
 * Ranking: more shared sources first. At an equal count, the higher weight
 * wins; a collection weighs 1/size, so a shared small collection says more
 * than a shared large one. Remaining ties keep the collections' own order
 * (collection order, then the member order inside each collection).
 *
 * New signals (authors, subjects, themes, movements, recommenders...) join
 * `signals` with a `union all` and their own `kind` and weight.
 */
export async function getSimilarWorks(workId: string, limit = 12) {
  z.string().uuid().parse(workId);
  z.number().int().min(1).max(50).parse(limit);
  const ranked = rows<{ workId: string; reasons: SimilarityReason[] }>(
    await db.execute(sql`
      with held as (
        -- A book is in a collection through an edition or as a whole book
        select ce.collection_id, e.work_id, ce.sort_order, ce.added_at
        from collection_editions ce join editions e on e.id = ce.edition_id
        union all
        select cw.collection_id, cw.work_id, cw.sort_order, cw.added_at
        from collection_works cw join works w on w.id = cw.work_id and w.kind = 'book'
      ), members as (
        select collection_id, work_id,
          min(sort_order) as position, min(added_at) as added_at
        from held
        where collection_id in (
          select collection_id from held where work_id = ${workId}::uuid
        )
        group by collection_id, work_id
      ), signals as (
        select m.work_id, 'collection' as kind, c.id as source_id,
          c.name as source_name,
          1.0 / count(*) over (partition by c.id) as weight,
          row_number() over (
            order by c.sort_order, c.name, c.id, m.position, m.added_at, m.work_id
          ) as ord
        from members m
        join collections c on c.id = m.collection_id
      )
      select work_id as "workId",
        jsonb_agg(
          jsonb_build_object('kind', kind, 'id', source_id, 'name', source_name)
          order by ord
        ) as reasons
      from signals
      where work_id <> ${workId}::uuid
      group by work_id
      order by count(*) desc, sum(weight) desc, min(ord)
      limit ${limit}
    `),
  );
  if (!ranked.length) return [];

  const found = await db.query.works.findMany({
    where: inArray(
      works.id,
      ranked.map((r) => r.workId),
    ),
    with: workCardWith,
  });
  const byId = new Map(found.map((w) => [w.id, w]));
  return ranked.flatMap(({ workId: id, reasons }) => {
    const work = byId.get(id);
    return work ? [{ ...work, reasons }] : [];
  });
}
