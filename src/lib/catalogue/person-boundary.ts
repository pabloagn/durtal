import { sql, type SQL } from "drizzle-orm";
import { authors } from "@/lib/db/schema";
import type { WorkKind } from "./kinds";

export function personDomainCondition(kind: WorkKind) {
  return sql`exists (select 1 from person_domains pd where pd.person_id = ${authors.id} and pd.kind = ${kind})`;
}
export const bookPersonCondition = personDomainCondition("book");

/**
 * Every credit of every person, one row per person and role: book writers
 * (`work_authors`), edition contributors (`edition_contributors`), the other
 * collections' credits (`work_credits`) and a perfume variant's own perfumers. Book links name their role in
 * text; `credit_roles` maps it to the shared role id ("book.author",
 * "book.edition.translator", "film.director"…).
 */
export const PERSON_CREDITS = sql`(
  select wa.author_id as person_id, cr.id as role_id from work_authors wa
    join credit_roles cr on cr.kind = 'book' and cr.level = 'work' and cr.legacy_role = wa.role
  union
  select ec.author_id, cr.id from edition_contributors ec
    join credit_roles cr on cr.kind = 'book' and cr.level = 'edition' and cr.legacy_role = ec.role
  union
  select wc.person_id, wc.role_id from work_credits wc where wc.person_id is not null
  union
  select p.person_id, 'perfume.perfumer' from perfume_variant_perfumers p where p.person_id is not null
)`;

/** People who belong to one of these collections */
export function personKindsCondition(kinds: WorkKind[]): SQL {
  return sql`exists (select 1 from person_domains pd where pd.person_id = ${authors.id} and pd.kind in (${sql.join(
    kinds.map((k) => sql`${k}`),
    sql`, `,
  )}))`;
}

/** People credited with one of these roles */
export function personRolesCondition(roleIds: string[]): SQL {
  return sql`exists (select 1 from ${PERSON_CREDITS} c where c.person_id = ${authors.id} and c.role_id in (${sql.join(
    roleIds.map((r) => sql`${r}`),
    sql`, `,
  )}))`;
}
