import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { BOOK_IN_HAND_STATUSES, orderStatusLabel } from "@/lib/constants/orders";
import { formatDate } from "@/lib/utils/format";
import {
  keptOrderRefusal,
  type CopyDeleteCounts,
  type WorkDeleteCounts,
} from "@/lib/catalogue/delete-cascade";

/*
 * What deleting books or a copy takes with it, read before the dialog asks
 * (SLN-1112). Every count is of rows the database removes in the same
 * delete: orders, acquisition targets and media go with the book by their
 * foreign keys, its copies with its editions.
 */

const uuids = (ids: string[]) =>
  sql`array[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`;

/** Orders with the book in hand: the acquisition record a delete keeps */
export const KEPT_ORDER_STATUSES = sql`(${sql.join(
  BOOK_IN_HAND_STATUSES.map((s) => sql`${s}`),
  sql`, `,
)})`;

/** The first order with the book in hand among these books, as a refusal */
export async function keptOrderRefusalFor(workIds: SQL): Promise<string | null> {
  const [order] = resultRows<{ title: string; status: string; venue: string | null; order_date: string | null }>(
    await db.execute(sql`
      select w.title, o.status, v.name as venue, o.order_date::text as order_date
      from orders o
      join works w on w.id = o.work_id
      left join venues v on v.id = o.venue_id
      where o.work_id = any(${workIds}) and o.status::text in ${KEPT_ORDER_STATUSES}
      order by w.title, o.order_date desc
      limit 1`),
  );
  return order
    ? keptOrderRefusal({
        title: order.title,
        status: orderStatusLabel(order.status),
        venue: order.venue,
        date: formatDate(order.order_date),
      })
    : null;
}

export type WorkDeleteSummary = Required<WorkDeleteCounts> & {
  /** Why the delete would be refused, or null */
  refusal: string | null;
};

/** What deleting these books takes with them, summed */
export async function workDeleteSummary(ids: string[]): Promise<WorkDeleteSummary> {
  const empty = { editions: 0, copies: 0, readings: 0, sessions: 0, quotes: 0, notes: 0, orders: 0, targets: 0, images: 0, ebooks: 0 };
  if (!ids.length) return { ...empty, refusal: null };
  const w = uuids(ids);
  const [[counts], refusal] = await Promise.all([
    db
      .execute(sql`
        select
          (select count(*) from editions where work_id = any(${w}))::int as editions,
          (select count(*) from instances i join editions e on e.id = i.edition_id where e.work_id = any(${w}))::int as copies,
          (select count(*) from readings where work_id = any(${w}))::int as readings,
          (select count(*) from reading_sessions s join readings r on r.id = s.reading_id where r.work_id = any(${w}))::int as sessions,
          (select count(*) from reading_notes where work_id = any(${w}) and kind = 'quote')::int as quotes,
          (select count(*) from reading_notes where work_id = any(${w}) and kind = 'note')::int as notes,
          (select count(*) from orders where work_id = any(${w}))::int as orders,
          (select count(*) from acquisition_targets where work_id = any(${w}))::int as targets,
          (select count(*) from media where work_id = any(${w}))::int as images,
          (select count(*) from ebooks eb join instances i on i.id = eb.instance_id join editions e on e.id = i.edition_id
            where e.work_id = any(${w}))::int as ebooks`)
      .then((r) => resultRows<Omit<WorkDeleteSummary, "refusal">>(r)),
    keptOrderRefusalFor(w),
  ]);
  return { ...empty, ...counts, refusal };
}

/** What deleting one copy takes with it, and what stays without it */
export async function copyDeleteSummary(id: string): Promise<CopyDeleteCounts> {
  const [counts] = resultRows<Omit<CopyDeleteCounts, "ebook"> & { ebooks: number }>(
    await db.execute(sql`
      select
        (select count(*) from instance_status_history where instance_id = ${id}::uuid)::int as history,
        (select count(*) from acquisition_target_copies where instance_id = ${id}::uuid)::int as targets,
        (select count(*) from readings where instance_id = ${id}::uuid)::int as readings,
        (select count(*) from orders where instance_id = ${id}::uuid)::int as orders,
        (select count(*) from ebooks where instance_id = ${id}::uuid)::int as ebooks`),
  );
  const { ebooks, ...rest } = counts;
  return { ...rest, ebook: ebooks > 0 };
}
