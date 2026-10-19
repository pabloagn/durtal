import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { formatOfCopy, type ReadingFormat } from "../constants";

/*
 * The edition and copy a reading matched by title and author gets at the
 * commit (SLN-1171): such a row names only the book. A book with exactly one
 * copy (deaccessioned ones aside) gives that copy, its edition and its
 * format; otherwise a book with exactly one edition gives the edition.
 * Anything else stays unlinked. Readings already written are left as they are.
 */

export interface SingleLink {
  editionId: string;
  instanceId: string | null;
  /** The copy's reading format; null when only the edition is linked */
  format: ReadingFormat | null;
}

export async function singleCopyLinks(workIds: string[]): Promise<Map<string, SingleLink>> {
  const ids = [...new Set(workIds)];
  if (!ids.length) return new Map();
  const found = resultRows<{ workId: string; editions: number; editionId: string; copies: number; instanceId: string | null; copyEditionId: string | null; copyFormat: string | null }>(
    await db.execute(sql`
      with ids as (select value::uuid as id from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)),
      eds as (select e.work_id, count(*)::int as n, min(e.id::text) as id from editions e where e.work_id in (select id from ids) group by 1),
      cps as (
        select e.work_id, count(*)::int as n, min(i.id::text) as id from instances i join editions e on e.id = i.edition_id
        where e.work_id in (select id from ids) and i.status <> 'deaccessioned' group by 1
      )
      select eds.work_id::text as "workId", eds.n as editions, eds.id as "editionId", coalesce(cps.n, 0) as copies,
        i.id::text as "instanceId", i.edition_id::text as "copyEditionId", i.format as "copyFormat"
      from eds left join cps on cps.work_id = eds.work_id
      left join instances i on cps.n = 1 and i.id = cps.id::uuid`),
  );
  const links = new Map<string, SingleLink>();
  for (const f of found) {
    if (f.copies === 1 && f.instanceId && f.copyEditionId)
      links.set(f.workId, { editionId: f.copyEditionId, instanceId: f.instanceId, format: formatOfCopy(f.copyFormat) });
    else if (f.editions === 1) links.set(f.workId, { editionId: f.editionId, instanceId: null, format: null });
  }
  return links;
}
