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
  numeric,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { publishingHouses } from "./publishing-houses";
import { editions } from "./editions";
import { instances } from "./instances";
import { works } from "./works";
import { perfumeVariants } from "./perfumes";
import { filmReleases, filmVersions } from "./films";
import { artObjects } from "./paintings";
import { PERFUME_CONTAINERS } from "@/lib/catalogue/perfumes";
import { FILM_HOLDING_MEDIA } from "@/lib/catalogue/films";

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
    // A perfume target: one formulation, in one container size (SLN-374)
    perfumeVariantId: uuid("perfume_variant_id").references(
      () => perfumeVariants.id,
      { onDelete: "restrict" },
    ),
    perfumeContainer: text("perfume_container", { enum: PERFUME_CONTAINERS }),
    perfumeCapacityValue: numeric("perfume_capacity_value", {
      precision: 15,
      scale: 6,
      mode: "number",
    }),
    perfumeVolumeUnit: text("perfume_volume_unit", { enum: ["ml", "l"] }),
    // A film target: one version, optionally one release, on one medium
    filmVersionId: uuid("film_version_id").references(() => filmVersions.id, {
      onDelete: "restrict",
    }),
    filmReleaseId: uuid("film_release_id").references(() => filmReleases.id, {
      onDelete: "restrict",
    }),
    filmMedium: text("film_medium", { enum: FILM_HOLDING_MEDIA }),
    filmFormatLabel: text("film_format_label"),
    // A painting target: an object for sale, or a reproduction of an object
    artObjectId: uuid("art_object_id").references(() => artObjects.id, {
      onDelete: "restrict",
    }),
    artReproducesObjectId: uuid("art_reproduces_object_id").references(
      () => artObjects.id,
      { onDelete: "restrict" },
    ),
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
    // One kind of target per row; each kind complete or absent
    check(
      "acquisition_target_typed_check",
      sql`num_nonnulls(coalesce(${t.editionId}, ${t.publisherId}), ${t.perfumeVariantId}, ${t.filmVersionId}, coalesce(${t.artObjectId}, ${t.artReproducesObjectId})) <= 1
        and (${t.perfumeVariantId} is null) = (${t.perfumeContainer} is null)
        and (${t.perfumeVariantId} is null) = (${t.perfumeCapacityValue} is null)
        and (${t.perfumeVariantId} is null) = (${t.perfumeVolumeUnit} is null)
        and (${t.perfumeCapacityValue} is null or (${t.perfumeCapacityValue} > 0 and ${t.perfumeCapacityValue} <= 1000000))
        and (${t.perfumeContainer} is null or ${t.perfumeContainer} in ('bottle','sample','decant'))
        and (${t.perfumeVolumeUnit} is null or ${t.perfumeVolumeUnit} in ('ml','l'))
        and (${t.filmVersionId} is null) = (${t.filmMedium} is null)
        and (${t.filmVersionId} is not null or (${t.filmReleaseId} is null and ${t.filmFormatLabel} is null))
        and (${t.filmMedium} is null or ${t.filmMedium} in ('physical','digital'))
        and (${t.filmFormatLabel} is null or length(trim(${t.filmFormatLabel})) between 1 and 200)
        and (${t.artObjectId} is null or ${t.artReproducesObjectId} is null)`,
    ),
    index("acquisition_targets_perfume_variant_idx").on(t.perfumeVariantId),
    index("acquisition_targets_film_version_idx").on(t.filmVersionId),
    index("acquisition_targets_film_release_idx").on(t.filmReleaseId),
    index("acquisition_targets_art_object_idx").on(t.artObjectId),
    index("acquisition_targets_art_reproduces_idx").on(t.artReproducesObjectId),
    index("acquisition_targets_work_idx").on(t.workId),
    index("acquisition_targets_publisher_idx").on(t.publisherId),
    // One active target per identity. A book's is its edition or publisher
    // (both empty: any edition); a perfume's its formulation and container
    // size, a film's its version, release and medium, a painting's its object
    uniqueIndex("acquisition_targets_active_unique")
      .on(
        t.workId,
        sql`coalesce(${t.editionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.publisherId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.perfumeVariantId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.perfumeContainer}, '')`,
        sql`coalesce(${t.perfumeCapacityValue} * case ${t.perfumeVolumeUnit} when 'l' then 1000 else 1 end, 0)`,
        sql`coalesce(${t.filmVersionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.filmReleaseId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.filmMedium}, '')`,
        sql`coalesce(${t.artObjectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.artReproducesObjectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
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

// Every change of a house's type or parent (task 0179): ownership changes
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

// Edition fields filled from a second metadata source (task 0179): the
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
