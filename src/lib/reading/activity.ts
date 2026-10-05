import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { recordActivity } from "@/lib/activity/record";
import { resultRows } from "@/lib/harmonization/store";
import { pagesOnDay } from "./service";

/*
 * The reading tracker's history entries (SLN-444, SLN-451), shared by the
 * page actions and the REST routes. Not a "use server" file: nothing here is
 * callable from a page.
 */

export function readingEvent(workId: string, key: string, reading: { id: string }, extra: Record<string, unknown> = {}) {
  recordActivity("work", workId, key, { extra: { readingId: reading.id, ...extra } });
}

/** At most one progress entry per reading per reading day */
export async function progressEvent(reading: { id: string; workId: string; currentPercent: number | null }, day: string) {
  const [seen] = resultRows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from activity_events
      where entity_type = 'work' and entity_id = ${reading.workId}::uuid and event_key = 'work.reading_progress'
      and metadata->'extra'->>'readingId' = ${reading.id} and metadata->'extra'->>'day' = ${day}`),
  );
  if (seen?.n) return;
  readingEvent(reading.workId, "work.reading_progress", reading, {
    day,
    pages: await pagesOnDay(reading.id, day),
    percent: reading.currentPercent,
  });
}
