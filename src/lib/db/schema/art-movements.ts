import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";

export const artMovements = pgTable("art_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artMovementsRelations = relations(artMovements, ({ many }) => ({
  workArtMovements: many(workArtMovements),
}));

export const workArtMovements = pgTable(
  "work_art_movements",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    artMovementId: uuid("art_movement_id")
      .notNull()
      .references(() => artMovements.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workId, t.artMovementId] })],
);

export const workArtMovementsRelations = relations(workArtMovements, ({ one }) => ({
  work: one(works, {
    fields: [workArtMovements.workId],
    references: [works.id],
  }),
  artMovement: one(artMovements, {
    fields: [workArtMovements.artMovementId],
    references: [artMovements.id],
  }),
}));
