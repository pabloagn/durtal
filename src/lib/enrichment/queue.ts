import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { ownedBookCondition } from "@/lib/catalogue/holdings";
import { enqueueEnrichmentJob } from "./jobs";

/*
 * Which books enrichment works first (SLN-464, the order of SLN-473's waves),
 * and the jobs a new book queues after its save: identity (SLN-464) and
 * research (SLN-469). Queueing spends nothing.
 */

/** The scopes a run can queue, in their order; `all` is every book, each at its own scope's priority */
export const ENRICHMENT_SCOPES = ["owned", "on_order", "wanted", "all"] as const;
export type EnrichmentScope = (typeof ENRICHMENT_SCOPES)[number];
/** Lower runs first: owned, on order, wanted, then the rest */
export const SCOPE_PRIORITY = { owned: 10, on_order: 20, wanted: 30, rest: 100 } as const;
/** A book from a bulk e-book accession runs after the rest (the reader epic, SLN-495) */
export const BULK_ACCESSION_PRIORITY = 200;

/** The books of one scope: a scope takes no book of an earlier one */
export function scopeCondition(scope: EnrichmentScope, workId: SQL): SQL {
  const owned = ownedBookCondition(workId);
  const status = (value: string) => sql`(select catalogue_status from works where id = ${workId}) = ${value}`;
  if (scope === "all") return sql`true`;
  if (scope === "owned") return owned;
  if (scope === "on_order") return sql`(not ${owned} and ${status("on_order")})`;
  return sql`(not ${owned} and ${status("wanted")})`;
}

/** A book's scope priority, as a SQL value */
export function scopePriority(workId: SQL): SQL<number> {
  return sql<number>`case when ${scopeCondition("owned", workId)} then ${SCOPE_PRIORITY.owned}
    when ${scopeCondition("on_order", workId)} then ${SCOPE_PRIORITY.on_order}
    when ${scopeCondition("wanted", workId)} then ${SCOPE_PRIORITY.wanted}
    else ${SCOPE_PRIORITY.rest} end`;
}

/**
 * Queues a new or newly identified book's identity and research jobs, after
 * its save has committed. Never throws: a save never fails because of the
 * queue, and a failure is logged with `[enrichment]`, like the publisher
 * auto-resolve. An open job of the book is merged, not duplicated.
 */
export async function queueNewBookEnrichment(workId: string, options: { priority?: number } = {}) {
  try {
    const [book] = resultRows<{ priority: number }>(
      await db.execute(sql`select ${scopePriority(sql`${workId}::uuid`)} as priority from works where id = ${workId}::uuid and kind = 'book'`),
    );
    if (!book) return;
    const priority = options.priority ?? Number(book.priority);
    await enqueueEnrichmentJob({ workId, kind: "identity", reason: "created", priority });
    await enqueueEnrichmentJob({ workId, kind: "research", reason: "created", priority });
  } catch (error) {
    console.error("[enrichment] Could not queue the new book's jobs", workId, error);
  }
}
