import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
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

export const readingsRelations = relations(readings, ({ one, many }) => ({
  work: one(works, { fields: [readings.workId], references: [works.id] }),
  edition: one(editions, { fields: [readings.editionId], references: [editions.id] }),
  instance: one(instances, { fields: [readings.instanceId], references: [instances.id] }),
  location: one(locations, { fields: [readings.locationId], references: [locations.id] }),
  sessions: many(readingSessions),
  statusHistory: many(readingStatusHistory),
}));

export const readingSessionsRelations = relations(readingSessions, ({ one }) => ({
  reading: one(readings, { fields: [readingSessions.readingId], references: [readings.id] }),
  edition: one(editions, { fields: [readingSessions.editionId], references: [editions.id] }),
}));

export const readingStatusHistoryRelations = relations(readingStatusHistory, ({ one }) => ({
  reading: one(readings, { fields: [readingStatusHistory.readingId], references: [readings.id] }),
}));
