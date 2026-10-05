import { pgTable, boolean, uuid, text, timestamp, smallint, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { catalogueStatusEnum } from "./enums";
import { locations } from "./locations";

/**
 * App-wide settings: a single row (its id is always true). They apply on
 * every device, unlike the display preferences each browser keeps in its
 * cookies. Read with getAppSettings (src/lib/actions/settings.ts).
 */
export const appSettings = pgTable(
  "app_settings",
  {
    id: boolean("id").primaryKey().default(true),
    /** Status a new book starts with in the add-book wizard */
    newBookStatus: catalogueStatusEnum("new_book_status").notNull().default("tracked"),
    /** ISO 639 code: a new book's language when its source gives none */
    newBookLanguage: text("new_book_language").notNull().default("en"),
    /** Where a new copy starts; null: pick for each copy. Cleared when the location is deleted. */
    newCopyLocationId: uuid("new_copy_location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    /** INSTANCE_FORMATS value a new copy starts with; null: none */
    newCopyFormat: text("new_copy_format").default("paperback"),
    /** INSTANCE_CONDITIONS value a new copy starts with; null: none */
    newCopyCondition: text("new_copy_condition").default("mint"),
    /** ISO 4217 code: new orders start in it, and spending totals list it first */
    homeCurrency: text("home_currency").notNull().default("EUR"),
    /** A session before this hour (0 to 6) counts for the day before; stored days never change (SLN-451) */
    readingDayStartHour: smallint("reading_day_start_hour").notNull().default(4),
    /** The first day of a reading week: 1 Monday or 7 Sunday */
    readingWeekStart: smallint("reading_week_start").notNull().default(1),
    /** Minutes of running time after which a timer asks "Still reading?" (15 to 480) */
    readingTimerCheckMinutes: smallint("reading_timer_check_minutes").notNull().default(90),
    /** Days he would like to read each week, 1 to 7; null: no rhythm shown (SLN-455) */
    readingRhythmDays: smallint("reading_rhythm_days"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("app_settings_single_row_check", sql`${t.id}`),
    check("app_settings_new_book_status_check", sql`${t.newBookStatus} <> 'deaccessioned'`),
    check("app_settings_new_book_language_check", sql`${t.newBookLanguage} ~ '^[a-z]{2,3}$'`),
    check("app_settings_home_currency_check", sql`${t.homeCurrency} ~ '^[A-Z]{3}$'`),
    check("app_settings_reading_day_start_hour_check", sql`${t.readingDayStartHour} between 0 and 6`),
    check("app_settings_reading_week_start_check", sql`${t.readingWeekStart} in (1, 7)`),
    check("app_settings_reading_timer_check_minutes_check", sql`${t.readingTimerCheckMinutes} between 15 and 480`),
    check("app_settings_reading_rhythm_days_check", sql`${t.readingRhythmDays} is null or ${t.readingRhythmDays} between 1 and 7`),
  ],
);
