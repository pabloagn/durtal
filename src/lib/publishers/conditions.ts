import { sql } from "drizzle-orm";
import { works } from "@/lib/db/schema";
import { z } from "zod/v4";

export function publisherWorkCondition(ids: string[]) {
  const safe = z.array(z.uuid()).max(100).parse(ids);
  return sql`(exists (select 1 from editions e join edition_publishers ep on ep.edition_id = e.id
    join publishing_houses p on p.id = ep.publisher_id
    where e.work_id = ${works.id} and (p.id in ${safe} or p.parent_id in ${safe})) or exists
    (select 1 from acquisition_targets t join publishing_houses p on p.id = t.publisher_id
     where t.work_id = ${works.id} and not t.is_cancelled and (p.id in ${safe} or p.parent_id in ${safe})))`;
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
