import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { ENTITY_TABLES, type ActivityEntityType } from "./entities";

/** A record as a history or a comment points at it: its name and its page */
export interface ResolvedEntity {
  type: ActivityEntityType;
  id: string;
  name: string;
  /** Its page today; null when it has none yet (an organization outside publishing) */
  href: string | null;
  /** Set when `id` was merged into this record */
  mergedFrom?: string;
}

/** Whether a record of this type exists now */
export async function ownerExists(type: ActivityEntityType, id: string) {
  if (!z.uuid().safeParse(id).success) return false;
  const rows = resultRows(
    await db.execute(sql`select 1 from ${sql.identifier(ENTITY_TABLES[type].table)} where id = ${id}::uuid`),
  );
  return rows.length > 0;
}

async function readEntity(type: ActivityEntityType, id: string): Promise<ResolvedEntity | null> {
  const [row] = resultRows<{
    name: string;
    slug: string | null;
    kind: string | null;
  }>(
    await db.execute(
      type === "work"
        ? sql`select title as name, slug, kind::text as kind from works where id = ${id}::uuid`
        : type === "author"
          ? sql`select name, slug, null as kind from authors where id = ${id}::uuid`
          : type === "organization"
            ? sql`select name, slug, kind from publishing_houses where id = ${id}::uuid`
            : sql`select name, slug, type::text as kind from venues where id = ${id}::uuid`,
    ),
  );
  if (!row) return null;
  const href =
    type === "work"
      ? row.kind === "book"
        ? row.slug && `/library/${row.slug}`
        : `${WORK_DOMAINS[row.kind as WorkKind].basePath}/${row.slug ?? id}`
      : type === "author"
        ? row.slug && `/authors/${row.slug}`
        : type === "organization"
          ? row.kind && `/publishers/${row.slug}`
          : row.slug && `/places/${row.slug}`;
  return { type, id, name: row.name, href: href || null };
}

/**
 * The record a history entry or a comment points at, as it is now. A record
 * merged into another resolves to the one it was merged into (following the
 * merge redirects, up to five steps). A deleted record resolves to null.
 */
export async function resolveEntity(type: ActivityEntityType, id: string): Promise<ResolvedEntity | null> {
  if (!z.uuid().safeParse(id).success) return null;
  let current = id;
  for (let step = 0; step < 5; step++) {
    const found = await readEntity(type, current);
    if (found) return current === id ? found : { ...found, mergedFrom: id };
    const [redirect] = resultRows<{ targetId: string }>(
      await db.execute(sql`select target_id as "targetId" from harmonization_redirects
        where source_id = ${current}::uuid and entity = ${ENTITY_TABLES[type].merge}`),
    );
    if (!redirect) return null;
    current = redirect.targetId;
  }
  return null;
}
