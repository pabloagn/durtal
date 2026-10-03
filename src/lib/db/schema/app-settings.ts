import { pgTable, boolean, uuid, text, timestamp, check } from "drizzle-orm/pg-core";
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("app_settings_single_row_check", sql`${t.id}`),
    check("app_settings_new_book_status_check", sql`${t.newBookStatus} <> 'deaccessioned'`),
    check("app_settings_new_book_language_check", sql`${t.newBookLanguage} ~ '^[a-z]{2,3}$'`),
    check("app_settings_home_currency_check", sql`${t.homeCurrency} ~ '^[A-Z]{3}$'`),
  ],
);
