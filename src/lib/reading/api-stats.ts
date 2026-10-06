import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { getGoalProgress } from "@/lib/actions/reading-goals";
import type { GoalMetric } from "./constants";
import { readingToday } from "./day";
import { countedPagesSql } from "./summary";

/*
 * Reading for GET /api/stats (SLN-458), which the TUI's dashboard shows:
 * the open readings and the year's numbers. The year is the current reading
 * day's year. Pages come from countedPagesSql, filtered to the year, summed,
 * then rounded; hours leave out the running timer. Computed per request.
 */

export interface ReadingApiStats {
  year: number;
  open: { title: string; status: "reading" | "paused"; percent: number | null }[];
  finishedThisYear: number;
  pagesThisYear: number;
  /** One decimal */
  hoursThisYear: number;
  /** One entry per goal of the year; empty without one */
  goals: { metric: GoalMetric; target: number; progress: number }[];
}

export async function readingApiStats(): Promise<ReadingApiStats> {
  const year = Number((await readingToday()).slice(0, 4));
  const [[row], goals] = await Promise.all([
    db
      .execute(sql`with cp as ${countedPagesSql()}
        select
          coalesce((select jsonb_agg(jsonb_build_object('title', w.title, 'status', r.status, 'percent', r.current_percent::float8)
              order by r.last_read_at desc nulls last, r.created_at desc)
            from readings r join works w on w.id = r.work_id where r.status in ('reading','paused') and w.kind = 'book'), '[]'::jsonb) as open,
          (select count(*)::float8 from readings r join works w on w.id = r.work_id
            where w.kind = 'book' and r.status = 'finished' and r.finished_precision <> 'unknown' and r.finished_on is not null
              and extract(year from r.finished_on) = ${year}) as "finishedThisYear",
          (select round(coalesce(sum(c.pages), 0))::float8 from cp c
            where c.day is not null and c.day_precision <> 'unknown' and extract(year from c.day) = ${year}) as "pagesThisYear",
          (select round(coalesce(sum(s.duration_seconds), 0)::numeric / 3600, 1)::float8 from reading_sessions s
            where s.duration_seconds is not null and not (s.source = 'timer' and s.ended_at is null)
              and extract(year from s.read_on) = ${year}) as "hoursThisYear"`)
      .then((r) => resultRows<Omit<ReadingApiStats, "year" | "goals">>(r)),
    getGoalProgress(year),
  ]);
  return {
    year,
    open: row?.open ?? [],
    finishedThisYear: row?.finishedThisYear ?? 0,
    pagesThisYear: row?.pagesThisYear ?? 0,
    hoursThisYear: row?.hoursThisYear ?? 0,
    goals: goals.map((g) => ({ metric: g.metric, target: g.target, progress: g.count })),
  };
}
