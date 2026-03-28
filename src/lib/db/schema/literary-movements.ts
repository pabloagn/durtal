import {
  pgTable,
  uuid,
  text,
  smallint,
  integer,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";

export const literaryMovements = pgTable("literary_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  level: smallint("level").notNull(),
  parentId: uuid("parent_id").references((): any => literaryMovements.id, {
    onDelete: "cascade",
  }),
  scopeNotes: text("scope_notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const literaryMovementsRelations = relations(literaryMovements, ({ one, many }) => ({
  parent: one(literaryMovements, {
    fields: [literaryMovements.parentId],
    references: [literaryMovements.id],
    relationName: "movementHierarchy",
  }),
  children: many(literaryMovements, { relationName: "movementHierarchy" }),
  workLiteraryMovements: many(workLiteraryMovements),
}));

export const workLiteraryMovements = pgTable(
  "work_literary_movements",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    literaryMovementId: uuid("literary_movement_id")
      .notNull()
      .references(() => literaryMovements.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workId, t.literaryMovementId] })],
);

export const workLiteraryMovementsRelations = relations(
  workLiteraryMovements,
  ({ one }) => ({
    work: one(works, {
      fields: [workLiteraryMovements.workId],
      references: [works.id],
    }),
    literaryMovement: one(literaryMovements, {
      fields: [workLiteraryMovements.literaryMovementId],
      references: [literaryMovements.id],
    }),
  }),
);
