import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";

export const attributes = pgTable("attributes", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  category: text("category"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attributesRelations = relations(attributes, ({ many }) => ({
  workAttributes: many(workAttributes),
}));

export const workAttributes = pgTable(
  "work_attributes",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workId, t.attributeId] })],
);

export const workAttributesRelations = relations(workAttributes, ({ one }) => ({
  work: one(works, {
    fields: [workAttributes.workId],
    references: [works.id],
  }),
  attribute: one(attributes, {
    fields: [workAttributes.attributeId],
    references: [attributes.id],
  }),
}));
