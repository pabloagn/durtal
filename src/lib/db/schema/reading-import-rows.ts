import { pgTable, uuid, integer, text, boolean, jsonb, primaryKey, index, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { imports } from "./imports";
import { works } from "./works";

/**
 * One data row of an uploaded reading history file (SLN-450): what the file
 * says, the book it matched, the decision, and what the commit wrote, so an
 * import's working state lives in Postgres, not in S3. `work_id` is a book
 * (trigger `book_parent_required`).
 */
export const readingImportRows = pgTable(
  "reading_import_rows",
  {
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    /** The file's data row number: 1 for the first row after the header */
    rowNo: integer("row_no").notNull(),
    /** The parsed row (`ImportRow`), everything the file carries */
    data: jsonb("data").notNull(),
    /** Section, reason, candidates with scores, and one duplicate verdict per reading */
    match: jsonb("match"),
    decision: text("decision", { enum: ["pending", "import", "skip"] }).notNull().default("pending"),
    /** Replace the book's different rating with the file's */
    useFileRating: boolean("use_file_rating").notNull().default(false),
    /** The matched or chosen book */
    workId: uuid("work_id").references(() => works.id, { onDelete: "set null" }),
    /** What the commit wrote: reading ids, the book rating before and after, identifier ids */
    written: jsonb("written"),
  },
  (t) => [
    primaryKey({ columns: [t.importId, t.rowNo] }),
    index("reading_import_rows_work_idx").on(t.workId),
    check("reading_import_rows_decision_check", sql`${t.decision} in ('pending','import','skip')`),
  ],
);

export const readingImportRowsRelations = relations(readingImportRows, ({ one }) => ({
  import: one(imports, { fields: [readingImportRows.importId], references: [imports.id] }),
  work: one(works, { fields: [readingImportRows.workId], references: [works.id] }),
}));
