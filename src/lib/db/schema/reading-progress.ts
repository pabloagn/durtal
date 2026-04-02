import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { calibreBooks } from "./calibre-books";

export const readingProgress = pgTable("reading_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  calibreBookId: uuid("calibre_book_id")
    .notNull()
    .unique()
    .references(() => calibreBooks.id, { onDelete: "cascade" }),

  // Position tracking (EPUB CFI or PDF page)
  currentCfi: text("current_cfi"),
  currentPage: integer("current_page"),
  progressPercent: real("progress_percent"),
  currentChapter: text("current_chapter"),

  // Reading stats
  totalReadingSeconds: integer("total_reading_seconds").default(0),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),

  // Bookmarks as JSONB (CFI + label + context)
  bookmarks: jsonb("bookmarks").$type<
    {
      cfi: string;
      label?: string;
      contextText?: string;
      createdAt: string;
    }[]
  >(),

  // Per-book reader settings
  readerSettings: jsonb("reader_settings").$type<{
    fontSize?: number;
    fontFamily?: string;
    lineHeight?: number;
    margin?: number;
    textAlign?: string;
  }>(),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const readingProgressRelations = relations(
  readingProgress,
  ({ one }) => ({
    calibreBook: one(calibreBooks, {
      fields: [readingProgress.calibreBookId],
      references: [calibreBooks.id],
    }),
  }),
);
