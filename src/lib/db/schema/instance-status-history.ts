import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { instanceStatusEnum } from "./enums";
import { instances } from "./instances";

export const instanceStatusHistory = pgTable("instance_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  instanceId: uuid("instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
  fromStatus: instanceStatusEnum("from_status"),
  toStatus: instanceStatusEnum("to_status").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
});

export const instanceStatusHistoryRelations = relations(instanceStatusHistory, ({ one }) => ({
  instance: one(instances, {
    fields: [instanceStatusHistory.instanceId],
    references: [instances.id],
  }),
}));
