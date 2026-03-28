import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";
import { editions } from "./editions";

// ── Subjects (work-level thematic classification) ────────────────────────────

export const subjects = pgTable("subjects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workSubjects = pgTable(
  "work_subjects",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workId, t.subjectId] })],
);

export const workSubjectsRelations = relations(workSubjects, ({ one }) => ({
  work: one(works, {
    fields: [workSubjects.workId],
    references: [works.id],
  }),
  subject: one(subjects, {
    fields: [workSubjects.subjectId],
    references: [subjects.id],
  }),
}));

// ── Genres (edition-level publishing categories, hierarchical) ───────────────

export const genres = pgTable("genres", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  parentId: uuid("parent_id").references((): any => genres.id, {
    onDelete: "set null",
  }),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const genresRelations = relations(genres, ({ one, many }) => ({
  parent: one(genres, {
    fields: [genres.parentId],
    references: [genres.id],
    relationName: "genreHierarchy",
  }),
  children: many(genres, { relationName: "genreHierarchy" }),
  editionGenres: many(editionGenres),
}));

export const editionGenres = pgTable(
  "edition_genres",
  {
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    genreId: uuid("genre_id")
      .notNull()
      .references(() => genres.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.editionId, t.genreId] })],
);

export const editionGenresRelations = relations(editionGenres, ({ one }) => ({
  edition: one(editions, {
    fields: [editionGenres.editionId],
    references: [editions.id],
  }),
  genre: one(genres, {
    fields: [editionGenres.genreId],
    references: [genres.id],
  }),
}));

// ── Tags (user-defined labels on editions) ───────────────────────────────────

export const tags = pgTable("tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const editionTags = pgTable(
  "edition_tags",
  {
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.editionId, t.tagId] })],
);

export const editionTagsRelations = relations(editionTags, ({ one }) => ({
  edition: one(editions, {
    fields: [editionTags.editionId],
    references: [editions.id],
  }),
  tag: one(tags, {
    fields: [editionTags.tagId],
    references: [tags.id],
  }),
}));
