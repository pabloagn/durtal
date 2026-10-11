import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ebooks } from "./ebooks";
import { readingSessions } from "./readings";

export const READER_RECEIPT_RETIRE_REASONS = [
  "session_deleted", "session_edited", "reading_deleted", "reading_closed",
  "reading_edited", "binding_changed", "book_merged", "compensated", "session_missing",
] as const;

/** Short-lived server-owned evidence for notes-surface paired Undo. No FK can
 * rewrite the original identity, and the browser never supplies the note row.
 * Declaration/custom functions are review input for 0087, not an applied DDL.
 */
export const readerQuoteUndoReceipts = pgTable("reader_quote_undo_receipts", {
  token: uuid("token").primaryKey(),
  noteId: uuid("note_id").notNull(),
  ebookId: uuid("ebook_id").notNull(),
  annotationId: uuid("annotation_id").notNull(),
  workId: uuid("work_id").notNull(),
  instanceId: uuid("instance_id").notNull(),
  editionId: uuid("edition_id").notNull(),
  noteSnapshot: jsonb("note_snapshot").$type<Record<string, unknown>>().notNull(),
  annotationFingerprint: text("annotation_fingerprint").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (t) => [
  index("reader_quote_undo_note_idx").on(t.noteId),
  check("reader_quote_undo_evidence_check", sql`coalesce(jsonb_typeof(${t.noteSnapshot})='object'
    and (${t.noteSnapshot}->>'id')::uuid=${t.noteId}
    and (${t.noteSnapshot}->>'work_id')::uuid=${t.workId}
    and (${t.noteSnapshot}->>'ebook_annotation_id')::uuid=${t.annotationId}
    and ${t.noteSnapshot}->>'kind'='quote'
    and ${t.annotationFingerprint} ~ '^[a-f0-9]{32}$'
    and isfinite(${t.expiresAt}) and (${t.usedAt} is null or isfinite(${t.usedAt})),false)`),
]);

/** Additive recovery input only. Applied migrations 0075/0076 are unchanged. */
export const legacyReaderProgress = pgTable("legacy_reader_progress", {
  ebookId: uuid("ebook_id").primaryKey().references(() => ebooks.id, { onDelete: "restrict" }),
  /** Historical fraction, not the tracker's 0..100 percent. */
  progressFraction: real("progress_fraction"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  preservedAt: timestamp("preserved_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("legacy_reader_progress_fraction_check", sql`${t.progressFraction} is null or ${t.progressFraction} between 0 and 1`),
  check("legacy_reader_progress_dates_check", sql`
    (${t.startedAt} is null or isfinite(${t.startedAt}))
    and (${t.lastReadAt} is null or isfinite(${t.lastReadAt}))
    and (${t.finishedAt} is null or isfinite(${t.finishedAt}))`),
]);

/**
 * Permanent sitting identities. Only sessionId is a live FK; original IDs must
 * survive deletes, merges and Undo. Review SQL supplies ownership/retirement
 * triggers; this declaration is not a generated or applied migration.
 */
export const readerSittingReceipts = pgTable("reader_sitting_receipts", {
  sittingId: uuid("sitting_id").primaryKey(),
  readingId: uuid("reading_id").notNull(),
  ebookId: uuid("ebook_id").notNull(),
  deviceId: uuid("device_id").notNull(),
  originalSessionId: uuid("original_session_id").notNull(),
  sessionId: uuid("session_id").references(() => readingSessions.id, { onDelete: "set null" }),
  revision: integer("revision").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  activeSeconds: integer("active_seconds").notNull(),
  startPercent: numeric("start_percent", { precision: 5, scale: 2, mode: "number" }).notNull(),
  endPercent: numeric("end_percent", { precision: 5, scale: 2, mode: "number" }).notNull(),
  endChapter: text("end_chapter"),
  timeZone: text("time_zone").notNull(),
  goingBack: boolean("going_back").notNull().default(false),
  state: text("state", { enum: ["active", "retired"] }).notNull().default("active"),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  retireReason: text("retire_reason", { enum: READER_RECEIPT_RETIRE_REASONS }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("reader_sitting_receipt_session_idx").on(t.sessionId),
  index("reader_sitting_receipt_reading_idx").on(t.readingId),
  index("reader_sitting_receipt_ebook_idx").on(t.ebookId),
  check("reader_sitting_receipt_values_check", sql`
    ${t.revision} between 1 and 2147483647
    and isfinite(${t.startedAt}) and isfinite(${t.endedAt})
    and ${t.endedAt} >= ${t.startedAt}
    and ${t.activeSeconds} between 1 and 86400
    and ${t.activeSeconds} <= floor(extract(epoch from (${t.endedAt} - ${t.startedAt})))
    and ${t.startPercent} between 0 and 100 and ${t.endPercent} between 0 and 100
    and (${t.endChapter} is null or char_length(${t.endChapter}) <= 300)
    and char_length(${t.timeZone}) between 1 and 100`),
  check("reader_sitting_receipt_retirement_check", sql`
    (${t.state} = 'active' and ${t.sessionId} is not null and ${t.retiredAt} is null and ${t.retireReason} is null)
    or (${t.state} = 'retired' and ${t.sessionId} is null and ${t.retiredAt} is not null
      and isfinite(${t.retiredAt})
      and ${t.retireReason} is not null
      and ${t.retireReason} in ${sql.raw(`(${READER_RECEIPT_RETIRE_REASONS.map((reason) => `'${reason}'`).join(",")})`)})`),
]);
