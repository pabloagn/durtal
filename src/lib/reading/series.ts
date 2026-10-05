import { sql } from "drizzle-orm";

/*
 * The next volume of a series to read (SLN-447): the first volume in series
 * order that is not finished, after the last finished one. Abandoned counts
 * as not finished. Series order is the series page's: `series_position` in
 * numeric order ("2" before "10"), blanks last, then title.
 */

export interface SeriesVolume {
  id: string;
  title: string;
  slug?: string | null;
  position: string | null;
  finished: boolean;
}

const numeric = (position: string | null) =>
  position !== null && /^[0-9]+(\.[0-9]+)?$/.test(position.trim()) ? Number(position) : null;

/** Volumes in series order */
export function seriesOrder<T extends Pick<SeriesVolume, "position" | "title">>(volumes: T[]): T[] {
  return [...volumes].sort((a, b) => {
    const pa = numeric(a.position),
      pb = numeric(b.position);
    if (pa !== pb) {
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    }
    return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
  });
}

/** The volume to read next, or null when every volume after the last finished one is finished */
export function nextVolume<T extends SeriesVolume>(volumes: T[]): T | null {
  const ordered = seriesOrder(volumes);
  const lastFinished = ordered.map((v) => v.finished).lastIndexOf(true);
  return ordered.slice(lastFinished + 1).find((v) => !v.finished) ?? null;
}

/** The series' next volume to read, by the readings of its books */
export async function nextToRead(seriesId: string) {
  const { db } = await import("@/lib/db");
  const { resultRows } = await import("@/lib/harmonization/store");
  const rows = resultRows<SeriesVolume>(
    await db.execute(sql`select w.id, w.title, w.slug, w.series_position as position,
        exists (select 1 from readings r where r.work_id = w.id and r.status = 'finished') as finished
      from works w where w.series_id = ${seriesId}::uuid and w.kind = 'book'`),
  );
  return nextVolume(rows);
}
