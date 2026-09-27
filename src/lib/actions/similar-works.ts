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
 * similar. Collections hold editions, so several editions of a work count
 * once per collection.
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
      with members as (
        select ce.collection_id, e.work_id,
          min(ce.sort_order) as position, min(ce.added_at) as added_at
        from collection_editions ce
        join editions e on e.id = ce.edition_id
        where ce.collection_id in (
          select ce2.collection_id from collection_editions ce2
          join editions e2 on e2.id = ce2.edition_id
          where e2.work_id = ${workId}::uuid
        )
        group by ce.collection_id, e.work_id
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
