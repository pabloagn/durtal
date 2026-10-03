"use server";

import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  curationOwnerSchema,
  curationPatchSchema,
  type CurationOwner,
  type CurationPatch,
} from "@/lib/catalogue/curation";
import {
  curationQueries,
  hasCurationChanges,
} from "@/lib/catalogue/curation-store";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";

function snapshot(owner: CurationOwner) {
  return sql`select jsonb_build_object('id',w.id,'kind',w.kind,'notes',w.notes,'rating',w.rating,'isFavourite',w.is_favourite,
    'recommenderIds',coalesce((select jsonb_agg(wr.recommender_id order by wr.recommender_id) from work_recommenders wr where wr.work_id=w.id),'[]'::jsonb)) as data
    from works w where w.id=${owner.id}::uuid and w.kind=${owner.kind}`;
}
export async function getWorkCuration(input: CurationOwner) {
  const owner = curationOwnerSchema.parse(input);
  const [row] = resultRows<{
    data: CurationOwner & {
      notes: string | null;
      rating: number | null;
      isFavourite: boolean;
      recommenderIds: string[];
    };
    fingerprint: string;
  }>(
    await db.execute(
      sql`select s.data,md5(s.data::text) as fingerprint from (${snapshot(owner)}) s`,
    ),
  );
  return row ? { ...row.data, fingerprint: row.fingerprint } : null;
}

/** Shared personal curation never creates holdings or changes a book's lifecycle. */
export async function updateWorkCuration(input: {
  owner: CurationOwner;
  patch: CurationPatch;
  fingerprint: string;
}) {
  const owner = curationOwnerSchema.parse(input.owner);
  const patch = curationPatchSchema.parse(input.patch);
  const fingerprint = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .parse(input.fingerprint);
  await atomic((d) => [
    d.execute(
      sql`select id from works where id=${owner.id}::uuid and kind=${owner.kind} for update`,
    ),
    d.execute(
      assertSql(
        sql`coalesce((select md5(s.data::text)=${fingerprint} from (${snapshot(owner)}) s),false)`,
        "Personal curation changed or the work no longer exists; reload before saving",
      ),
    ),
    ...curationQueries(d, owner, patch),
  ]);
  if (hasCurationChanges(patch)) invalidate(CACHE_TAGS.works, CACHE_TAGS.recommenders);
  return (await getWorkCuration(owner))!;
}
