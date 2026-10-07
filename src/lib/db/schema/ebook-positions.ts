import { pgTable, uuid, text, real, jsonb, timestamp, index, foreignKey, unique, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { ebooks, ebookFiles } from "./ebooks";

/**
 * The reader's place in one file, per device (SLN-490). Created empty here:
 * the reader writes it from sub-issue 3, and other devices' places are shown
 * from sub-issue 4. The reading tracker only reads it.
 */
export const ebookPositions = pgTable(
  "ebook_positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ebookId: uuid("ebook_id")
      .notNull()
      .references(() => ebooks.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull(),
    /** The durtal-device cookie: a random uuid */
    deviceId: text("device_id").notNull(),
    /** "iPhone · Safari" */
    deviceLabel: text("device_label").notNull(),
    /** A DurtalLocator */
    locator: jsonb("locator").$type<Record<string, unknown>>().notNull(),
    /** totalProgression, 0 to 1 */
    progression: real("progression").notNull(),
    /** The greatest progression ever on this device and file */
    furthestProgression: real("furthest_progression").notNull(),
    chapter: text("chapter"),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A file of this e-book, never another's (SLN-518)
    foreignKey({ name: "ebook_positions_file_ebook_fk", columns: [t.fileId, t.ebookId], foreignColumns: [ebookFiles.id, ebookFiles.ebookId] }).onDelete("cascade"),
    unique("ebook_positions_file_device_unique").on(t.fileId, t.deviceId),
    index("ebook_positions_ebook_updated_idx").on(t.ebookId, t.updatedAt.desc()),
    check(
      "ebook_positions_progression_check",
      sql`${t.progression} between 0 and 1 and ${t.furthestProgression} between 0 and 1`,
    ),
  ],
);

export const ebookPositionsRelations = relations(ebookPositions, ({ one }) => ({
  ebook: one(ebooks, { fields: [ebookPositions.ebookId], references: [ebooks.id] }),
  file: one(ebookFiles, { fields: [ebookPositions.fileId], references: [ebookFiles.id] }),
}));
