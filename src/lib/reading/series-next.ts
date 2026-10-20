import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { nextVolume, type SeriesVolume } from "./series";

/*
 * The database half of series.ts (SLN-1278): series.ts is pure and reaches
 * the browser through the suggestion scoring, so the query lives here.
 */

/** The series' next volume to read, by the readings of its books */
export async function nextToRead(seriesId: string) {
  const rows = resultRows<SeriesVolume>(
    await db.execute(sql`select w.id, w.title, w.slug, w.series_position as position,
        exists (select 1 from readings r where r.work_id = w.id and r.status = 'finished') as finished,
        exists (select 1 from readings r where r.work_id = w.id and r.status in ('reading', 'paused')) as reading
      from works w where w.series_id = ${seriesId}::uuid and w.kind = 'book'`),
  );
  return nextVolume(rows);
}
