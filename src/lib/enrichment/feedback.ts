import { sql, type SQL } from "drizzle-orm";
import type { FeedbackReason } from "@/lib/reading/constants";
import { WORK_AUTHOR_ROLES } from "@/lib/types";
import { AUTHOR_PAUSE_DAYS } from "@/lib/reading/suggest/score";

/*
 * Recommendation feedback for the book enrichment epic (SLN-463). The table,
 * its reason codes and its writes are the reading tracker's (SLN-457); this
 * module only reads them. SLN-471's runner and SLN-472's route use these
 * helpers to hide exactly what the suggestion engine hides.
 */

/**
 * The enrichment dimension each reason code points at, by vocabulary v1's
 * keys (its section 8), or none. Too long and too short point at the length.
 */
export const FEEDBACK_REASON_DIMENSIONS: Record<FeedbackReason, string | null> = {
  too_long: "pages",
  too_short: "pages",
  not_in_the_mood: null,
  prose: "prose",
  genre: "speculative_level",
  too_popular: "popularity",
  already_read: null,
  other: null,
};

/** A book's writers, as the engine's loader reads them (src/lib/reading/suggest/load.ts) */
const WRITER_ROLES = sql.raw(`(${WORK_AUTHOR_ROLES.map((r) => `'${r}'`).join(", ")})`);

/**
 * True for a book his feedback hides: Never and Not for me until removed,
 * Not now until its day (`today`, a "YYYY-MM-DD" reading day). The SQL twin
 * of `hiddenByFeedback` (src/lib/reading/suggest/score.ts), so it also hides
 * a Not now with no day.
 */
export function feedbackExclusionCondition(workIdSql: SQL | unknown, today: string): SQL<boolean> {
  return sql<boolean>`exists (select 1 from recommendation_feedback fb_f where fb_f.work_id = ${workIdSql}
    and (fb_f.verdict <> 'not_now' or fb_f.until is null or fb_f.until > ${today}::date))`;
}

/**
 * True for a book by a paused author: two Not for me books by one writer
 * within AUTHOR_PAUSE_DAYS pause that writer until AUTHOR_PAUSE_DAYS after the
 * second. The SQL twin of `pausedAuthors`: each feedback row counts once per
 * writer row, on the day of its last change.
 */
export function feedbackPausedAuthorCondition(workIdSql: SQL | unknown, today: string): SQL<boolean> {
  return sql<boolean>`exists (select 1 from work_authors fb_w where fb_w.work_id = ${workIdSql} and fb_w.role in ${WRITER_ROLES}
    and fb_w.author_id in (
      select fb_d.author_id from (
        select fb_a.author_id, fb_f.updated_at::date as day,
          lag(fb_f.updated_at::date) over (partition by fb_a.author_id order by fb_f.updated_at::date) as previous
        from recommendation_feedback fb_f
        join works fb_b on fb_b.id = fb_f.work_id and fb_b.kind = 'book'
        join work_authors fb_a on fb_a.work_id = fb_f.work_id and fb_a.role in ${WRITER_ROLES}
        where fb_f.verdict = 'rejected'
      ) fb_d
      where fb_d.previous is not null and fb_d.day - fb_d.previous <= ${AUTHOR_PAUSE_DAYS}
        and fb_d.day + ${AUTHOR_PAUSE_DAYS}::int > ${today}::date))`;
}
