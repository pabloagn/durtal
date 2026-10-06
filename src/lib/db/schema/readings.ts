import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  numeric,
  date,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { works } from "./works";
import { editions } from "./editions";
import { instances } from "./instances";
import { locations } from "./locations";
import { imports } from "./imports";
import {
  ABANDON_REASONS,
  READING_DATE_PRECISIONS,
  READING_FORMATS,
  READING_SOURCES,
  READING_STATUSES,
  READING_UNITS,
  SESSION_SOURCES,
  QUEUE_SOURCES,
  NOTE_KINDS,
  NOTE_SOURCES,
  GOAL_METRICS,
  FEEDBACK_REASONS,
  FEEDBACK_SOURCES,
  FEEDBACK_VERDICTS,
  FEEDBACK_NOTE_MAX,
} from "@/lib/reading/constants";

/** A list of allowed values for a CHECK: ('a','b') */
const list = (values: readonly string[]) => sql.raw(`(${values.map((v) => `'${v}'`).join(",")})`);

/**
 * One read-through of a book (SLN-444): its edition, copy, home, format,
 * status, dates with their precision, start and current position, totals,
 * rating and review. A book has many (re-reads); one at most is open.
 */
export const readings = pgTable(
  "readings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "set null" }),
    instanceId: uuid("instance_id").references(() => instances.id, { onDelete: "set null" }),
    /** The home this read happens in: always a physical location */
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    format: text("format", { enum: READING_FORMATS }).notNull().default("print"),
    status: text("status", { enum: READING_STATUSES }).notNull().default("reading"),
    /** The first day of the known period: 2009-01-01 for "2009" */
    startedOn: date("started_on"),
    startedPrecision: text("started_precision", { enum: READING_DATE_PRECISIONS }).notNull(),
    finishedOn: date("finished_on"),
    finishedPrecision: text("finished_precision", { enum: READING_DATE_PRECISIONS }).notNull().default("unknown"),
    unit: text("unit", { enum: READING_UNITS }).notNull().default("pages"),
    totalPages: integer("total_pages"),
    totalMinutes: integer("total_minutes"),
    startPage: integer("start_page"),
    startPercent: numeric("start_percent", { precision: 5, scale: 2, mode: "number" }),
    startMinutes: integer("start_minutes"),
    currentPage: integer("current_page"),
    currentPercent: numeric("current_percent", { precision: 5, scale: 2, mode: "number" }),
    currentMinutes: integer("current_minutes"),
    currentChapter: text("current_chapter"),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    rating: numeric("rating", { precision: 2, scale: 1, mode: "number" }),
    reviewHtml: text("review_html"),
    reviewJson: jsonb("review_json"),
    abandonReason: text("abandon_reason", { enum: ABANDON_REASONS }),
    abandonNote: text("abandon_note"),
    source: text("source", { enum: READING_SOURCES }).notNull().default("manual"),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    /** Built only by src/lib/reading/source-keys.ts; null for readings made in the app */
    sourceKey: text("source_key").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One open reading per book
    uniqueIndex("reading_open_unique").on(t.workId).where(sql`${t.status} in ('reading','paused')`),
    index("reading_work_idx").on(t.workId),
    index("reading_status_idx").on(t.status),
    index("reading_finished_idx").on(t.finishedOn),
    index("reading_last_read_idx").on(t.lastReadAt),
    index("reading_import_idx").on(t.importId),
    index("reading_edition_idx").on(t.editionId),
    index("reading_instance_idx").on(t.instanceId),
    index("reading_location_idx").on(t.locationId),
    check(
      "reading_values_check",
      sql`${t.format} in ${list(READING_FORMATS)} and ${t.status} in ${list(READING_STATUSES)}
        and ${t.startedPrecision} in ${list(READING_DATE_PRECISIONS)} and ${t.finishedPrecision} in ${list(READING_DATE_PRECISIONS)}
        and ${t.unit} in ${list(READING_UNITS)} and ${t.source} in ${list(READING_SOURCES)}
        and (${t.abandonReason} is null or ${t.abandonReason} in ${list(ABANDON_REASONS)})`,
    ),
    check(
      "reading_precision_check",
      sql`(${t.startedOn} is null) = (${t.startedPrecision} = 'unknown') and (${t.finishedOn} is null) = (${t.finishedPrecision} = 'unknown')`,
    ),
    check(
      "reading_status_dates_check",
      sql`${t.status} not in ('reading','paused') or (${t.finishedOn} is null and ${t.finishedPrecision} = 'unknown')`,
    ),
    check(
      "reading_abandon_check",
      sql`${t.status} = 'abandoned' or (${t.abandonReason} is null and ${t.abandonNote} is null)`,
    ),
    check(
      "reading_position_check",
      sql`(${t.totalPages} is null or ${t.totalPages} > 0) and (${t.totalMinutes} is null or ${t.totalMinutes} > 0)
        and (${t.startPage} is null or (${t.startPage} >= 0 and (${t.totalPages} is null or ${t.startPage} <= ${t.totalPages})))
        and (${t.currentPage} is null or (${t.currentPage} >= 0 and (${t.totalPages} is null or ${t.currentPage} <= ${t.totalPages})))
        and (${t.startMinutes} is null or (${t.startMinutes} >= 0 and (${t.totalMinutes} is null or ${t.startMinutes} <= ${t.totalMinutes})))
        and (${t.currentMinutes} is null or (${t.currentMinutes} >= 0 and (${t.totalMinutes} is null or ${t.currentMinutes} <= ${t.totalMinutes})))
        and (${t.startPercent} is null or ${t.startPercent} between 0 and 100)
        and (${t.currentPercent} is null or ${t.currentPercent} between 0 and 100)
        and (${t.currentChapter} is null or length(${t.currentChapter}) between 1 and 300)`,
    ),
    check(
      "reading_rating_check",
      sql`${t.rating} is null or (${t.rating} >= 0.5 and ${t.rating} <= 5 and ${t.rating} * 2 = trunc(${t.rating} * 2))`,
    ),
    check("reading_note_check", sql`${t.abandonNote} is null or length(${t.abandonNote}) <= 2000`),
  ],
);

/**
 * One sitting or one progress update of a reading: its reading day, times,
 * start and end position in the edition read, and the page total it was
 * logged against.
 */
export const readingSessions = pgTable(
  "reading_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    readingId: uuid("reading_id")
      .notNull()
      .references(() => readings.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "set null" }),
    format: text("format", { enum: READING_FORMATS }).notNull(),
    /** The reading day, stored once: a later change of the day start hour leaves it */
    readOn: date("read_on").notNull(),
    timeZone: text("time_zone").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    startPage: integer("start_page"),
    endPage: integer("end_page"),
    startPercent: numeric("start_percent", { precision: 5, scale: 2, mode: "number" }),
    endPercent: numeric("end_percent", { precision: 5, scale: 2, mode: "number" }),
    startMinutes: integer("start_minutes"),
    endMinutes: integer("end_minutes"),
    endChapter: text("end_chapter"),
    /** The page count this session was logged against */
    pagesTotal: integer("pages_total"),
    /** For the session list only; totals count with countedPagesSql */
    pagesRead: integer("pages_read").generatedAlwaysAs(
      sql`case when start_page is not null and end_page is not null then greatest(end_page - start_page, 0) end`,
    ),
    note: text("note"),
    source: text("source", { enum: SESSION_SOURCES }).notNull().default("manual"),
    /** Set while a running timer is paused (SLN-451) */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    /** A timer's paused time so far, left out of its duration */
    pausedSeconds: integer("paused_seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one running timer in the app
    uniqueIndex("reading_session_timer_unique")
      .on(sql`(true)`)
      .where(sql`${t.source} = 'timer' and ${t.endedAt} is null`),
    index("reading_session_reading_idx").on(t.readingId, t.readOn),
    index("reading_session_day_idx").on(t.readOn),
    index("reading_session_edition_idx").on(t.editionId),
    check(
      "reading_session_values_check",
      sql`${t.format} in ${list(READING_FORMATS)} and ${t.source} in ${list(SESSION_SOURCES)}
        and (${t.endedAt} is null or ${t.startedAt} is null or ${t.endedAt} >= ${t.startedAt})
        and (${t.durationSeconds} is null or ${t.durationSeconds} between 1 and 86400)
        and (${t.startPage} is null or ${t.startPage} >= 0) and (${t.endPage} is null or ${t.endPage} >= 0)
        and (${t.startPercent} is null or ${t.startPercent} between 0 and 100)
        and (${t.endPercent} is null or ${t.endPercent} between 0 and 100)
        and (${t.startMinutes} is null or ${t.startMinutes} >= 0) and (${t.endMinutes} is null or ${t.endMinutes} >= 0)
        and (${t.pagesTotal} is null or ${t.pagesTotal} > 0)
        and (${t.endChapter} is null or length(${t.endChapter}) <= 300)
        and (${t.note} is null or length(${t.note}) <= 2000)`,
    ),
    check("reading_session_paused_check", sql`${t.pausedAt} is null or (${t.source} = 'timer' and ${t.endedAt} is null)`),
    check("reading_session_paused_seconds_check", sql`${t.pausedSeconds} between 0 and 86400`),
  ],
);

/** Every status change of a reading; pause intervals for pace come from here */
export const readingStatusHistory = pgTable(
  "reading_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    readingId: uuid("reading_id")
      .notNull()
      .references(() => readings.id, { onDelete: "cascade" }),
    fromStatus: text("from_status", { enum: READING_STATUSES }),
    toStatus: text("to_status", { enum: READING_STATUSES }).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => [
    index("reading_status_history_reading_idx").on(t.readingId, t.changedAt),
    check(
      "reading_status_history_values_check",
      sql`(${t.fromStatus} is null or ${t.fromStatus} in ${list(READING_STATUSES)}) and ${t.toStatus} in ${list(READING_STATUSES)}`,
    ),
  ],
);

/**
 * Up Next (SLN-452): the books he wants to read next, in his order. One row
 * per book, separate from what he wants to buy: it never changes
 * catalogue_status. Positions leave gaps of QUEUE_GAP so a move takes the
 * middle; a full renumber restores them. A guard trigger keeps the edition
 * on the row's book (migration 0068).
 */
export const readingQueue = pgTable(
  "reading_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .unique()
      .references(() => works.id, { onDelete: "cascade" }),
    /** The edition he means to read; null leaves the choice to the Start dialog */
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    note: text("note"),
    source: text("source", { enum: QUEUE_SOURCES }).notNull().default("manual"),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    /** Built only by goodreadsToReadKey and storygraphToReadKey */
    sourceKey: text("source_key").unique(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reading_queue_position_idx").on(t.position),
    check("reading_queue_source_check", sql`${t.source} in ${list(QUEUE_SOURCES)}`),
    check("reading_queue_note_check", sql`${t.note} is null or length(${t.note}) <= 500`),
  ],
);

/**
 * The commonplace book (SLN-453): a passage he keeps (a quote, with his
 * thought about it) or his own note, against a book and, when known, its
 * page, chapter, edition and reading. A guard trigger keeps the reading and
 * the edition on the note's book and lets the audited book merge through
 * (migration 0069).
 */
export const readingNotes = pgTable(
  "reading_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    readingId: uuid("reading_id").references(() => readings.id, { onDelete: "set null" }),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "set null" }),
    kind: text("kind", { enum: NOTE_KINDS }).notNull(),
    /** The passage or the note: plain text with its line breaks */
    body: text("body").notNull(),
    /** His thought about a quote, sanitized with sanitizeCommentHtml */
    commentHtml: text("comment_html"),
    /** The same thought as a Tiptap document */
    commentJson: jsonb("comment_json"),
    page: integer("page"),
    /** The last page of a passage over a page turn (SLN-480): after `page` */
    endPage: integer("end_page"),
    /** `page` and `end_page` are front matter, printed in roman numerals (xiv is stored as 14) */
    pageRoman: boolean("page_roman").notNull().default(false),
    chapter: text("chapter"),
    percent: numeric("percent", { precision: 5, scale: 2, mode: "number" }),
    isFavourite: boolean("is_favourite").notNull().default(false),
    source: text("source", { enum: NOTE_SOURCES }).notNull().default("manual"),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    /** Built only by goodreadsNoteKey */
    sourceKey: text("source_key").unique(),
    /** The body and chapter without accents, for the commonplace book's search; search_normalize() is from migration 0021 */
    searchText: text("search_text").generatedAlwaysAs(sql`search_normalize(body || ' ' || coalesce(chapter, ''))`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reading_note_work_page_idx").on(t.workId, t.page),
    index("reading_note_created_idx").on(t.createdAt),
    index("reading_note_search_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
    index("reading_note_reading_idx").on(t.readingId),
    index("reading_note_edition_idx").on(t.editionId),
    index("reading_note_import_idx").on(t.importId),
    check(
      "reading_note_values_check",
      sql`${t.kind} in ${list(NOTE_KINDS)} and ${t.source} in ${list(NOTE_SOURCES)}
        and length(${t.body}) between 1 and 10000
        and (${t.page} is null or ${t.page} >= 0)
        and (${t.chapter} is null or length(${t.chapter}) between 1 and 300)
        and (${t.percent} is null or ${t.percent} between 0 and 100)`,
    ),
    // Only quotes carry a thought
    check("reading_note_comment_check", sql`${t.kind} = 'quote' or (${t.commentHtml} is null and ${t.commentJson} is null)`),
    // A range ends after it starts; roman pages start at i (SLN-480)
    check(
      "reading_note_page_range_check",
      sql`(${t.endPage} is null or (${t.page} is not null and ${t.endPage} > ${t.page}))
        and (not ${t.pageRoman} or (${t.page} is not null and ${t.page} >= 1))`,
    ),
  ],
);

/**
 * Reading goals (SLN-455): optional, at most one per metric per year (a
 * books goal and an hours goal can sit side by side). No book: no
 * book_parent_required trigger. Progress is computed per request.
 */
export const readingGoals = pgTable(
  "reading_goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    year: smallint("year").notNull(),
    metric: text("metric", { enum: GOAL_METRICS }).notNull(),
    target: integer("target").notNull(),
    /** With it off, a re-read adds no books, pages or hours */
    countRereads: boolean("count_rereads").notNull().default(true),
    /** Work types left out (reference books); ids that no longer exist are ignored */
    excludedWorkTypeIds: uuid("excluded_work_type_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reading_goal_year_metric_unique").on(t.year, t.metric),
    check(
      "reading_goal_values_check",
      sql`${t.year} between 1900 and 2200 and ${t.metric} in ${list(GOAL_METRICS)} and ${t.target} between 1 and 100000`,
    ),
  ],
);

export const readingsRelations = relations(readings, ({ one, many }) => ({
  work: one(works, { fields: [readings.workId], references: [works.id] }),
  edition: one(editions, { fields: [readings.editionId], references: [editions.id] }),
  instance: one(instances, { fields: [readings.instanceId], references: [instances.id] }),
  location: one(locations, { fields: [readings.locationId], references: [locations.id] }),
  sessions: many(readingSessions),
  statusHistory: many(readingStatusHistory),
}));

/**
 * Suggestion feedback (SLN-457), as the reading tracker's parent defines it
 * for both it and the book enrichment epic: one row per book, Not now (until
 * a date), Never, or rejected with reasons. Every write is an upsert on
 * work_id: the newer verdict replaces the older, and source is the latest
 * writer. book_parent_required keeps it on books (migration 0071_reading_suggestions).
 */
export const recommendationFeedback = pgTable(
  "recommendation_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .unique()
      .references(() => works.id, { onDelete: "cascade" }),
    verdict: text("verdict", { enum: FEEDBACK_VERDICTS }).notNull(),
    /** Codes from FEEDBACK_REASONS */
    reasons: text("reasons").array().notNull().default(sql`'{}'::text[]`),
    note: text("note"),
    /** For not_now: hidden until this day (30 days after the verdict by default) */
    until: date("until"),
    source: text("source", { enum: FEEDBACK_SOURCES }).notNull().default("suggestions"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "recommendation_feedback_values_check",
      sql`${t.verdict} in ${list(FEEDBACK_VERDICTS)} and ${t.source} in ${list(FEEDBACK_SOURCES)}
        and ${t.reasons} <@ array${sql.raw(`[${FEEDBACK_REASONS.map((r) => `'${r}'`).join(",")}]`)}::text[]
        and (${t.note} is null or length(${t.note}) <= ${sql.raw(String(FEEDBACK_NOTE_MAX))})`,
    ),
  ],
);

export const readingSessionsRelations = relations(readingSessions, ({ one }) => ({
  reading: one(readings, { fields: [readingSessions.readingId], references: [readings.id] }),
  edition: one(editions, { fields: [readingSessions.editionId], references: [editions.id] }),
}));

export const readingStatusHistoryRelations = relations(readingStatusHistory, ({ one }) => ({
  reading: one(readings, { fields: [readingStatusHistory.readingId], references: [readings.id] }),
}));

export const readingQueueRelations = relations(readingQueue, ({ one }) => ({
  work: one(works, { fields: [readingQueue.workId], references: [works.id] }),
  edition: one(editions, { fields: [readingQueue.editionId], references: [editions.id] }),
}));

export const readingNotesRelations = relations(readingNotes, ({ one }) => ({
  work: one(works, { fields: [readingNotes.workId], references: [works.id] }),
  reading: one(readings, { fields: [readingNotes.readingId], references: [readings.id] }),
  edition: one(editions, { fields: [readingNotes.editionId], references: [editions.id] }),
}));

export const recommendationFeedbackRelations = relations(recommendationFeedback, ({ one }) => ({
  work: one(works, { fields: [recommendationFeedback.workId], references: [works.id] }),
}));
