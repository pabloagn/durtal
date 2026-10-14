import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { REVIEW_RECEIPT_EVENTS } from "./receipts";

/** A review decision on one eBook, as its receipt recorded it (SLN-684) */
export interface EbookDecision {
  id: string;
  createdAt: string;
  action: string;
  message: string | null;
}
export const DECISIONS_SHOWN = 20;

/**
 * The eBook's review decisions, newest first: linking, unlinking, keeping,
 * setting aside and their Undos. Each decision's receipt is the activity
 * event the review service writes with it, so nothing else records them.
 */
export async function getEbookDecisions(ebookId: string, conn: Db = db): Promise<{ decisions: EbookDecision[]; total: number }> {
  const events = [REVIEW_RECEIPT_EVENTS.ebookDecision, REVIEW_RECEIPT_EVENTS.ebookUndo];
  const where = sql`a.entity_type = 'ebook' and a.entity_id = ${ebookId}::uuid
    and a.event_key in (${sql.join(events.map((key) => sql`${key}`), sql`, `)})`;
  const [row] = resultRows<{ decisions: EbookDecision[]; total: number }>(await conn.execute(sql`select
    coalesce((select json_agg(d order by d."createdAt" desc, d.id) from (
      select a.id, a.created_at as "createdAt", a.metadata #>> '{extra,ebookReview,action}' as action,
        a.metadata #>> '{extra,ebookReview,outcome,message}' as message
      from activity_events a where ${where} order by a.created_at desc, a.id limit ${DECISIONS_SHOWN}) d), '[]'::json) as decisions,
    (select count(*)::integer from activity_events a where ${where}) as total`));
  return { decisions: row?.decisions ?? [], total: row?.total ?? 0 };
}
