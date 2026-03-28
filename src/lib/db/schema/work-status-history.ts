import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { catalogueStatusEnum } from "./enums";
import { works } from "./works";

export const workStatusHistory = pgTable("work_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  workId: uuid("work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),
  fromStatus: catalogueStatusEnum("from_status"),
  toStatus: catalogueStatusEnum("to_status").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
});

export const workStatusHistoryRelations = relations(workStatusHistory, ({ one }) => ({
  work: one(works, {
    fields: [workStatusHistory.workId],
    references: [works.id],
  }),
}));
