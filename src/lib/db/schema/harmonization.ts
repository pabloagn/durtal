import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/** Decisions are tied to evidence, so a changed problem returns to the inbox. */
export const harmonizationDecisions = pgTable("harmonization_decisions", {
  findingKey: text("finding_key").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Complete source and relationship snapshots are retained even after a merge. */
export const harmonizationOperations = pgTable(
  "harmonization_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    sourceId: uuid("source_id").notNull(),
    targetId: uuid("target_id"),
    label: text("label").notNull(),
    before: jsonb("before").notNull(),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("harmonization_operations_created_idx").on(t.createdAt)],
);

export const harmonizationRedirects = pgTable(
  "harmonization_redirects",
  {
    sourceId: uuid("source_id").primaryKey(),
    entity: text("entity").notNull(),
    sourceSlug: text("source_slug"),
    targetId: uuid("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("harmonization_redirects_slug_idx").on(t.entity, t.sourceSlug)],
);
