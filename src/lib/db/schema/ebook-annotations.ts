import { pgTable, uuid, text, real, jsonb, timestamp, index, foreignKey, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { ebooks, ebookFiles } from "./ebooks";

/**
 * Highlights (with notes) and bookmarks in an e-book (SLN-490). Created empty
 * here; sub-issue 11 writes them. `deleted_at` is a tombstone for sync.
 */
export const ebookAnnotations = pgTable(
  "ebook_annotations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ebookId: uuid("ebook_id")
      .notNull()
      .references(() => ebooks.id, { onDelete: "restrict" }),
    /** The file the locator was made in */
    fileId: uuid("file_id").notNull(),
    kind: text("kind", { enum: ["highlight", "bookmark"] }).notNull(),
    /** quote is set only by the tracker's saveReaderQuote */
    style: text("style", { enum: ["highlight", "underline", "quote"] }).notNull().default("highlight"),
    /** Null for bookmarks and quotes */
    color: text("color", { enum: ["ochre", "sage", "slate", "rose", "violet"] }),
    /** A DurtalLocator */
    locator: jsonb("locator").$type<Record<string, unknown>>().notNull(),
    progression: real("progression").notNull(),
    chapter: text("chapter"),
    /** The quoted passage; null for bookmarks */
    text: text("text"),
    note: text("note"),
    anchorState: text("anchor_state", { enum: ["exact", "healed", "approximate", "orphaned"] })
      .notNull()
      .default("exact"),
    deviceId: text("device_id"),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // A file of this e-book, never another's (SLN-518)
    foreignKey({ name: "ebook_annotations_file_ebook_fk", columns: [t.fileId, t.ebookId], foreignColumns: [ebookFiles.id, ebookFiles.ebookId] }).onDelete("restrict"),
    check("ebook_annotations_kind_check", sql`${t.kind} in ('highlight', 'bookmark')`),
    check("ebook_annotations_style_check", sql`${t.style} in ('highlight', 'underline', 'quote')`),
    check(
      "ebook_annotations_color_check",
      sql`${t.color} is null or ${t.color} in ('ochre', 'sage', 'slate', 'rose', 'violet')`,
    ),
    check(
      "ebook_annotations_anchor_state_check",
      sql`${t.anchorState} in ('exact', 'healed', 'approximate', 'orphaned')`,
    ),
    check("ebook_annotations_text_check", sql`${t.text} is null or char_length(${t.text}) <= 10000`),
    index("ebook_annotations_ebook_idx").on(t.ebookId, t.deletedAt, t.progression),
  ],
);

export const ebookAnnotationsRelations = relations(ebookAnnotations, ({ one }) => ({
  ebook: one(ebooks, { fields: [ebookAnnotations.ebookId], references: [ebooks.id] }),
  file: one(ebookFiles, { fields: [ebookAnnotations.fileId], references: [ebookFiles.id] }),
}));
