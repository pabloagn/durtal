import {
  pgTable,
  uuid,
  text,
  smallint,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";
import { editions } from "./editions";
import { media } from "./media";
import { contributionTypes } from "./contribution-types";

export const authors = pgTable("authors", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  sortName: text("sort_name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  realName: text("real_name"),
  gender: text("gender"),
  birthYear: smallint("birth_year"),
  birthMonth: smallint("birth_month"),
  birthDay: smallint("birth_day"),
  birthYearIsApproximate: boolean("birth_year_is_approximate").notNull().default(false),
  birthYearGregorian: text("birth_year_gregorian"),
  deathYear: smallint("death_year"),
  deathMonth: smallint("death_month"),
  deathDay: smallint("death_day"),
  deathYearIsApproximate: boolean("death_year_is_approximate").notNull().default(false),
  deathYearGregorian: text("death_year_gregorian"),
  nationality: text("nationality"),
  bio: text("bio"),
  photoS3Key: text("photo_s3_key"),
  website: text("website"),
  openLibraryKey: text("open_library_key"),
  goodreadsId: text("goodreads_id"),
  metadataSource: text("metadata_source"),
  metadataSourceId: text("metadata_source_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authorsRelations = relations(authors, ({ many }) => ({
  workAuthors: many(workAuthors),
  editionContributors: many(editionContributors),
  authorContributionTypes: many(authorContributionTypes),
  media: many(media),
}));

// Work-level: links authors as primary creators
export const workAuthors = pgTable(
  "work_authors",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("author"),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.workId, t.authorId, t.role] })],
);

export const workAuthorsRelations = relations(workAuthors, ({ one }) => ({
  work: one(works, {
    fields: [workAuthors.workId],
    references: [works.id],
  }),
  author: one(authors, {
    fields: [workAuthors.authorId],
    references: [authors.id],
  }),
}));

// Edition-level: links contributors specific to a publication
export const editionContributors = pgTable(
  "edition_contributors",
  {
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.editionId, t.authorId, t.role] })],
);

export const editionContributorsRelations = relations(
  editionContributors,
  ({ one }) => ({
    edition: one(editions, {
      fields: [editionContributors.editionId],
      references: [editions.id],
    }),
    author: one(authors, {
      fields: [editionContributors.authorId],
      references: [authors.id],
    }),
  }),
);

// Junction: what roles an author is known for (writer, poet, editor, etc.)
export const authorContributionTypes = pgTable(
  "author_contribution_types",
  {
    authorId: uuid("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    contributionTypeId: uuid("contribution_type_id")
      .notNull()
      .references(() => contributionTypes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.authorId, t.contributionTypeId] })],
);

export const authorContributionTypesRelations = relations(
  authorContributionTypes,
  ({ one }) => ({
    author: one(authors, {
      fields: [authorContributionTypes.authorId],
      references: [authors.id],
    }),
    contributionType: one(contributionTypes, {
      fields: [authorContributionTypes.contributionTypeId],
      references: [contributionTypes.id],
    }),
  }),
);
