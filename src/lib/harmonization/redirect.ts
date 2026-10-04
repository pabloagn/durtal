import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { entityDefinition } from "./registry";
import { persistenceAvailable, resultRows } from "./store";

/** Old bookmarks follow the surviving record, including after subsequent merges. */
export async function redirectMergedRecord(
  entityKey: string,
  slugOrId: string,
) {
  if (!(await persistenceAvailable())) return;
  const entity = entityDefinition(entityKey);
  const rows = resultRows<{ id: string; slug?: string; kind?: string }>(
    await db.execute(sql`
    select t.* from harmonization_redirects r join ${sql.identifier(entity.table)} t on t.id = r.target_id
    where not exists (select 1 from ${sql.identifier(entity.table)} live where live.id::text = ${slugOrId} ${["authors", "works", "publishers", "venues"].includes(entityKey) ? sql`or live.slug = ${slugOrId}` : sql``})
    and r.entity = ${entityKey} and (r.source_id::text = ${slugOrId} or r.source_slug = ${slugOrId}) limit 1
  `),
  );
  // A merged film, perfume or painting opens on its own collection's page
  const route =
    entityKey === "works"
      ? (WORK_DOMAINS[rows[0]?.kind as WorkKind]?.basePath ?? entity.route)
      : entity.route;
  if (rows[0])
    redirect(
      `${route}/${["series", "collections", "recommenders"].includes(entityKey) ? rows[0].id : rows[0].slug || rows[0].id}`,
    );
}
