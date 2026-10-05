"use server";

import { asc, sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { readingGoals, workTypes } from "@/lib/db/schema";
import { resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { getAppSettings } from "@/lib/actions/settings";
import { readingToday } from "@/lib/reading/day";
import { countedPagesSql, rereadSql } from "@/lib/reading/summary";
import { addDays, rhythmRange } from "@/lib/reading/goals";
import type { GoalMetric, ReadingDatePrecision } from "@/lib/reading/constants";
import { goalYearSchema, removeReadingGoalSchema, setReadingGoalSchema } from "@/lib/validations/reading-goals";

/*
 * Reading goals and the weekly rhythm (SLN-455). Progress and rhythm are
 * computed per request from the readings, never cached: one query each.
 * Pages come only from countedPagesSql; hours and the rhythm leave out the
 * running timer. No activity events.
 */

export interface GoalProgress {
  id: string;
  year: number;
  metric: GoalMetric;
  target: number;
  countRereads: boolean;
  excludedWorkTypeIds: string[];
  /** Books, pages (rounded) or hours so far */
  count: number;
  /** The reading day the count reached the target, and that finish's precision */
  reachedOn: string | null;
  reachedPrecision: ReadingDatePrecision | null;
  /** The same count over the 90 reading days up to today, for the pace line */
  last90: number;
  /** The average length of the books finished this year and the year before, by the goal's rules */
  avgPages: number | null;
  avgPagesLastYear: number | null;
  /** Audiobooks read this year without a page count: 0 pages each */
  audioWithoutPages: number;
  /** The names of the work types left out that still exist */
  excludedWorkTypes: string[];
}

/** Every reading with whether it is a re-read: the window runs over all readings, before any filter */
const READINGS = sql`select r.id, r.work_id, r.status, r.format, r.total_pages, r.finished_on, r.finished_precision, ${rereadSql("r")} as reread from readings r`;

/** The goal's readings: a re-read only when the goal counts re-reads, a book of a work type it leaves out never */
const counts = (g: string) =>
  sql.raw(`(${g}.count_rereads or not rr.reread) and not coalesce(w.work_type_id = any(${g}.excluded_work_type_ids), false)`);

/**
 * The goal's units, one row each: (day, precision, amount, ord). Books: a
 * finished reading with a known date. Pages: countedPagesSql's rows. Hours:
 * ended sessions' durations. `within` filters on the unit's day `u_day`.
 */
function unitsSql(g: string, within: (day: SQL) => SQL) {
  const metric = sql.raw(`${g}.metric`);
  return sql`
    select rr.finished_on as day, rr.finished_precision as precision, 1::float8 as amount, rr.id::text as ord
    from rr join works w on w.id = rr.work_id
    where ${metric} = 'books' and rr.status = 'finished' and rr.finished_precision <> 'unknown' and rr.finished_on is not null
      and ${within(sql`rr.finished_on`)} and ${counts(g)}
    union all
    select c.day, c.day_precision, c.pages, coalesce(c.session_id::text, c.reading_id::text)
    from cp c join rr on rr.id = c.reading_id join works w on w.id = rr.work_id
    where ${metric} = 'pages' and c.day is not null and c.day_precision <> 'unknown' and ${within(sql`c.day`)} and ${counts(g)}
    union all
    select s.read_on, 'day', s.duration_seconds::float8 / 3600, s.id::text
    from reading_sessions s join rr on rr.id = s.reading_id join works w on w.id = rr.work_id
    where ${metric} = 'hours' and s.duration_seconds is not null and not (s.source = 'timer' and s.ended_at is null)
      and ${within(sql`s.read_on`)} and ${counts(g)}`;
}

/** Average pages of the books the goal counts as finished in a year */
const avgPagesSql = (g: string, yearOffset: number) =>
  sql`(select avg(rr.total_pages)::float8 from rr join works w on w.id = rr.work_id
    where rr.status = 'finished' and rr.finished_precision <> 'unknown' and rr.total_pages is not null
      and extract(year from rr.finished_on) = ${sql.raw(g)}.year + ${yearOffset} and ${counts(g)})`;

/** Goals matching `where` (over reading_goals g), with their progress, in one query */
async function goalsWithProgress(where: SQL, today: string): Promise<GoalProgress[]> {
  const inYear = (day: SQL) => sql`extract(year from ${day}) = g.year`;
  const last90 = (day: SQL) => sql`${day} between ${addDays(today, -89)}::date and ${today}::date`;
  return resultRows<GoalProgress>(
    await db.execute(sql`with rr as (${READINGS}), cp as ${countedPagesSql()}
      select g.id::text as id, g.year::int as year, g.metric, g.target::int as target, g.count_rereads as "countRereads",
        g.excluded_work_type_ids::text[] as "excludedWorkTypeIds",
        case when g.metric = 'pages' then round(coalesce(t.total, 0))::float8 else coalesce(t.total, 0)::float8 end as count,
        t.reached_on as "reachedOn", t.reached_precision as "reachedPrecision",
        coalesce((select sum(u.amount) from (${unitsSql("g", last90)}) u), 0)::float8 as last90,
        ${avgPagesSql("g", 0)} as "avgPages",
        ${avgPagesSql("g", -1)} as "avgPagesLastYear",
        (select count(*)::float8 from rr where rr.format = 'audio' and rr.total_pages is null
          and (extract(year from rr.finished_on) = g.year
            or exists (select 1 from reading_sessions s where s.reading_id = rr.id and extract(year from s.read_on) = g.year))) as "audioWithoutPages",
        coalesce((select array_agg(wt.name order by wt.name) from work_types wt where wt.id = any(g.excluded_work_type_ids)), '{}')::text[] as "excludedWorkTypes"
      from reading_goals g
      left join lateral (
        select max(u.running) as total,
          (array_agg(u.day::text order by u.day, u.ord) filter (where u.running >= g.target))[1] as reached_on,
          (array_agg(u.precision order by u.day, u.ord) filter (where u.running >= g.target))[1] as reached_precision
        from (select u.*, sum(u.amount) over (order by u.day, u.ord rows unbounded preceding) as running
          from (${unitsSql("g", inYear)}) u) u
      ) t on true
      where ${where}
      order by g.year desc, array_position(array['books','pages','hours'], g.metric)`),
  );
}

/** The goals of a year with their progress; computed per request */
export async function getGoalProgress(year: number): Promise<GoalProgress[]> {
  const y = goalYearSchema.parse(year);
  return goalsWithProgress(sql`g.year = ${y}`, await readingToday());
}

/** Every past year with a goal and its result, in one query */
export async function getGoalHistory(): Promise<GoalProgress[]> {
  const today = await readingToday();
  return goalsWithProgress(sql`g.year < ${Number(today.slice(0, 4))}`, today);
}

/** What the goal dialog needs: this year's and next year's goals, the work types and the past years */
export async function getGoalDialogData() {
  const today = await readingToday();
  const year = Number(today.slice(0, 4));
  const [goals, types, history] = await Promise.all([
    db
      .select({
        year: readingGoals.year,
        metric: readingGoals.metric,
        target: readingGoals.target,
        countRereads: readingGoals.countRereads,
        excludedWorkTypeIds: readingGoals.excludedWorkTypeIds,
      })
      .from(readingGoals)
      .where(sql`${readingGoals.year} between ${year} and ${year + 1}`),
    db.select({ id: workTypes.id, name: workTypes.name }).from(workTypes).orderBy(asc(workTypes.name)),
    getGoalHistory(),
  ]);
  return { year, goals, workTypes: types, history: history.map(({ year: y, metric, target, count }) => ({ year: y, metric, target, count })) };
}

/** Sets a year's goal for one metric, replacing the one there */
export async function setReadingGoal(input: z.input<typeof setReadingGoalSchema>) {
  const data = setReadingGoalSchema.parse(input);
  const now = new Date();
  await withReadableErrors(() =>
    atomic((d) => [
      d
        .insert(readingGoals)
        .values({ ...data, updatedAt: now })
        .onConflictDoUpdate({
          target: [readingGoals.year, readingGoals.metric],
          set: { target: data.target, countRereads: data.countRereads, excludedWorkTypeIds: data.excludedWorkTypeIds, updatedAt: now },
        }),
    ]),
  );
  invalidate(CACHE_TAGS.reading);
  return { year: data.year, metric: data.metric };
}

/** Removes a year's goal for one metric; nothing happens when there is none */
export async function removeReadingGoal(input: z.input<typeof removeReadingGoalSchema>) {
  const data = removeReadingGoalSchema.parse(input);
  await withReadableErrors(() =>
    atomic((d) => [d.delete(readingGoals).where(sql`${readingGoals.year} = ${data.year} and ${readingGoals.metric} = ${data.metric}`)]),
  );
  invalidate(CACHE_TAGS.reading);
  return { year: data.year, metric: data.metric };
}

export interface Rhythm {
  /** Days he would like to read each week; null: the rhythm is off */
  target: number | null;
  weekStart: 1 | 7;
  /** The server's reading day; the browser recomputes with its own */
  today: string;
  /** His reading days in the last 13 weeks, a day to spare on each side */
  days: string[];
}

/**
 * The weekly rhythm: a reading day has an ended session (by its read_on; the
 * running timer never counts) or a finish at day precision.
 */
export async function getRhythm(): Promise<Rhythm> {
  const [settings, today] = await Promise.all([getAppSettings(), readingToday()]);
  const weekStart = settings.readingWeekStart;
  if (!settings.readingRhythmDays) return { target: null, weekStart, today, days: [] };
  const { from, to } = rhythmRange(today, weekStart);
  const days = resultRows<{ day: string }>(
    await db.execute(sql`select distinct d.day::text as day from (
        select s.read_on as day from reading_sessions s where not (s.source = 'timer' and s.ended_at is null) and s.read_on between ${from}::date and ${to}::date
        union
        select r.finished_on from readings r where r.status = 'finished' and r.finished_precision = 'day' and r.finished_on between ${from}::date and ${to}::date
      ) d order by 1`),
  ).map((r) => r.day);
  return { target: settings.readingRhythmDays, weekStart, today, days };
}
