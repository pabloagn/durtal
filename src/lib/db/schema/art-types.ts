import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";

export const artTypes = pgTable("art_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  applicableWorkTypes: text("applicable_work_types"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artTypesRelations = relations(artTypes, ({ many }) => ({
  workArtTypes: many(workArtTypes),
}));

export const workArtTypes = pgTable(
  "work_art_types",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    artTypeId: uuid("art_type_id")
      .notNull()
      .references(() => artTypes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workId, t.artTypeId] })],
);

export const workArtTypesRelations = relations(workArtTypes, ({ one }) => ({
  work: one(works, {
    fields: [workArtTypes.workId],
    references: [works.id],
  }),
  artType: one(artTypes, {
    fields: [workArtTypes.artTypeId],
    references: [artTypes.id],
  }),
}));
