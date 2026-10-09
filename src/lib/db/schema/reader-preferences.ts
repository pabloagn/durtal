import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DEVICE_CLASSES,
  type PresentationOverride,
} from "@/lib/validations/reader-preferences";
import { ebooks } from "./ebooks";

/** Declaration proposal for migration 0085; no migration has been generated. */
export const readerPreferences = pgTable(
  "reader_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceClass: text("device_class", { enum: DEVICE_CLASSES }).notNull(),
    ebookId: uuid("ebook_id").references(() => ebooks.id, {
      onDelete: "cascade",
    }),
    /** Complete validated defaults, or a nonempty validated book override. */
    presentation: jsonb("presentation").$type<PresentationOverride>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("reader_preferences_scope_unique")
      .on(t.deviceClass, t.ebookId)
      .nullsNotDistinct(),
    index("reader_preferences_ebook_id_idx").on(t.ebookId),
    check(
      "reader_preferences_device_class_check",
      sql`${t.deviceClass} in ('phone', 'tablet', 'desktop')`,
    ),
  ],
);
