import {
  pgTable,
  uuid,
  timestamp,
  primaryKey,
  index,
  boolean,
  check,
  uniqueIndex,
  text,
  integer,
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

// The publisher part of an ISBN ("978159017" for 978-1-59017-…) and its house.
// An edition whose publisher and imprint text match no house links through
// the longest rule that starts its ISBN.
export const publisherIsbnPrefixes = pgTable(
  "publisher_isbn_prefixes",
  {
    prefix: text("prefix").primaryKey(),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishingHouses.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("publisher_isbn_prefixes_publisher_idx").on(t.publisherId),
    check(
      "publisher_isbn_prefix_format",
      sql`${t.prefix} ~ '^97[89][0-9]{2,10}$'`,
    ),
  ],
);

// Publisher text that names no publisher (a distributor, a printer). Such a
// name never matches a house; the edition's ISBN rule still applies.
export const ignoredPublisherNames = pgTable(
  "ignored_publisher_names",
  {
    nameKey: text("name_key").primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "ignored_publisher_name_key",
      sql`${t.nameKey} = publisher_name_key(${t.name})`,
    ),
  ],
);

// Automatic publisher decisions (task 0172): a name linked to a similar house
// (alias) or made into a new house (create). Kept for review and undo. A name
// with any row, undone or not, is never decided automatically again.
export const publisherAutoDecisions = pgTable(
  "publisher_auto_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nameKey: text("name_key").notNull(),
    name: text("name").notNull(),
    action: text("action").notNull(),
    publisherId: uuid("publisher_id").references(() => publishingHouses.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
    editionCount: integer("edition_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    index("publisher_auto_decisions_publisher_idx").on(t.publisherId),
    uniqueIndex("publisher_auto_decisions_name_key").on(t.nameKey),
    check(
      "publisher_auto_decision_action",
      sql`${t.action} in ('alias', 'create')`,
    ),
  ],
);

// Every change of a house's type or parent (task 0176): ownership changes
// over time, books stay on their imprint, and the move is kept here.
export const publisherHierarchyChanges = pgTable(
  "publisher_hierarchy_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishingHouses.id, { onDelete: "cascade" }),
    oldKind: text("old_kind").notNull(),
    newKind: text("new_kind").notNull(),
    oldParentId: uuid("old_parent_id"),
    newParentId: uuid("new_parent_id"),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("publisher_hierarchy_changes_publisher_idx").on(t.publisherId)],
);

// Edition fields filled from a second metadata source (task 0176): the
// imprint printed on the book and the country of publication. One run can be
// undone by restoring `old_value`.
export const editionEnrichments = pgTable(
  "edition_enrichments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").notNull(),
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value").notNull(),
    source: text("source").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    index("edition_enrichments_run_idx").on(t.runId),
    index("edition_enrichments_edition_idx").on(t.editionId),
    check(
      "edition_enrichment_field",
      sql`${t.field} in ('imprint', 'publication_country')`,
    ),
  ],
);
