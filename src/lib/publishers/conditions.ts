import { sql } from "drizzle-orm";
import { works } from "@/lib/db/schema";
import { z } from "zod/v4";

/** Works with an edition, or an open wanted edition, from these houses or any house below them */
export function publisherWorkCondition(ids: string[]) {
  const safe = z.array(z.uuid()).min(1).max(100).parse(ids);
  const family = sql`(select publisher_family(r) from unnest(array[${sql.join(
    safe.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]) r)`;
  return sql`(exists (select 1 from editions e join edition_publishers ep on ep.edition_id = e.id
    where e.work_id = ${works.id} and ep.publisher_id in ${family}) or exists
    (select 1 from acquisition_targets t
     where t.work_id = ${works.id} and not t.is_cancelled and t.publisher_id in ${family}))`;
}

// Explicit qualification avoids Drizzle relational queries re-aliasing inner target columns to works.
// Receipt is derived from a linked, matching order. Returns/cancellations reopen the target.
export const targetState = sql<
  "wanted" | "on_order" | "received" | "cancelled"
>`case
 when "acquisition_targets"."is_cancelled" then 'cancelled'
 when exists (select 1 from acquisition_target_copies c join instances i on i.id = c.instance_id where c.target_id = "acquisition_targets"."id" and i.status <> 'deaccessioned' and target_accepts_edition("acquisition_targets"."id",i.edition_id)) then 'received'
 when exists (select 1 from orders o where o.acquisition_target_id = "acquisition_targets"."id"
  and o.status in ('delivered', 'purchased', 'received') and target_accepts_edition("acquisition_targets"."id", o.edition_id)) then 'received'
 when exists (select 1 from orders o where o.acquisition_target_id = "acquisition_targets"."id"
  and o.status not in ('cancelled', 'returned', 'delivered', 'purchased', 'received')) then 'on_order'
 else 'wanted' end`;

export function catalogueStatusCondition(statuses: string[]) {
  const acquisitionStates = statuses.filter(
    (s) => s === "wanted" || s === "on_order",
  );
  return sql`(${works.catalogueStatus} in ${statuses}${acquisitionStates.length ? sql` or exists (select 1 from acquisition_targets where work_id = ${works.id} and (${targetState}) in ${acquisitionStates})` : sql``})`;
}
