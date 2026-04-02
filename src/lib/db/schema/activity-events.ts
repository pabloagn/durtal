import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export interface ActivityMetadata {
  oldValue?: string | number | null;
  newValue?: string | number | null;
  targetName?: string;
  targetId?: string;
  taxonomyType?: string;
  editionIsbn?: string;
  locationName?: string;
  collectionName?: string;
  commentId?: string;
  extra?: Record<string, unknown>;
}

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    eventKey: text("event_key").notNull(),
    metadata: jsonb("metadata").$type<ActivityMetadata>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("activity_events_entity_idx").on(t.entityType, t.entityId),
    index("activity_events_created_at_idx").on(t.createdAt),
  ],
);
