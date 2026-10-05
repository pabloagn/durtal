import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { openReadingPercentSql, readCountSql, readingStateSql } from "./summary";
import type { ReadingSummaryValue } from "./card";

/**
 * Many books' reading state, finished reads and open share, in one query
 * (SLN-449): a collection's members, any number of them. Server only.
 */
export async function readingStatesFor(workIds: string[]): Promise<Map<string, Pick<ReadingSummaryValue, "state" | "timesRead" | "percent">>> {
  const ids = [...new Set(workIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return new Map();
  const rows = resultRows<{ id: string; state: ReadingSummaryValue["state"]; timesRead: number; percent: number | null }>(
    await db.execute(sql`select w.id, ${readingStateSql(sql`w.id`)} as state, ${readCountSql(sql`w.id`)} as "timesRead",
        ${openReadingPercentSql(sql`w.id`)} as percent
      from works w where w.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`),
  );
  return new Map(rows.map((r) => [r.id, { state: r.state, timesRead: Number(r.timesRead), percent: r.percent === null ? null : Number(r.percent) }]));
}
