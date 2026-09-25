import {
  pgTable,
  uuid,
  timestamp,
  primaryKey,
  index,
  boolean,
  check,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { publishingHouses } from "./publishing-houses";
import { editions } from "./editions";
import { instances } from "./instances";
import { works } from "./works";

export const editionPublishers = pgTable(
  "edition_publishers",
  {
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishingHouses.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.editionId, t.publisherId] }),
    index("edition_publishers_publisher_idx").on(t.publisherId),
  ],
);

export const acquisitionTargets = pgTable(
  "acquisition_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").references(() => editions.id, {
      onDelete: "restrict",
    }),
    publisherId: uuid("publisher_id").references(() => publishingHouses.id, {
      onDelete: "restrict",
    }),
    isCancelled: boolean("is_cancelled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "acquisition_target_kind_check",
      sql`${t.editionId} IS NULL OR ${t.publisherId} IS NULL`,
    ),
    index("acquisition_targets_work_idx").on(t.workId),
    index("acquisition_targets_publisher_idx").on(t.publisherId),
    uniqueIndex("acquisition_targets_active_unique")
      .on(
        t.workId,
        sql`coalesce(${t.editionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.publisherId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`NOT ${t.isCancelled}`),
  ],
);

export const editionPublishersRelations = relations(
  editionPublishers,
  ({ one }) => ({
    edition: one(editions, {
      fields: [editionPublishers.editionId],
      references: [editions.id],
    }),
    publisher: one(publishingHouses, {
      fields: [editionPublishers.publisherId],
      references: [publishingHouses.id],
    }),
  }),
);

// Explicit fulfilment when a copy is accessioned without an order.
export const acquisitionTargetCopies = pgTable(
  "acquisition_target_copies",
  {
    targetId: uuid("target_id")
      .primaryKey()
      .references(() => acquisitionTargets.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
  },
  (t) => [index("acquisition_target_copies_instance_idx").on(t.instanceId)],
);
