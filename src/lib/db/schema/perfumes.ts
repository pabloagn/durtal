import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  primaryKey,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { works } from "./works";
import { authors } from "./authors";
import { attributionEnum } from "./enums";
import { catalogueDates, sourceRecords } from "./provenance";
import { publishingHouses } from "./publishing-houses";
import { taxonomyFamilies, customTaxonomyItems } from "./taxonomy-families";
import { locations, subLocations } from "./locations";
import { venues } from "./venues";
import {
  PERFUME_CONCENTRATIONS,
  PERFUME_CONTAINERS,
  PERFUME_ORGANIZATION_ROLES,
  NOTE_POSITIONS,
} from "@/lib/catalogue/perfumes";
import { PERSONAL_HOLDING_STATUSES } from "@/lib/catalogue/holdings";

const source = () =>
  uuid("source_record_id").references(() => sourceRecords.id);
const releaseDates = () => ({
  releaseDateId: uuid("release_date_id").references(() => catalogueDates.id),
  discontinuedDateId: uuid("discontinued_date_id").references(
    () => catalogueDates.id,
  ),
});
export const perfumeDetails = pgTable("perfume_details", {
  workId: uuid("work_id")
    .primaryKey()
    .references(() => works.id, { onDelete: "cascade" }),
  ...releaseDates(),
  sourceRecordId: source(),
});
export const perfumeVariants = pgTable(
  "perfume_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => perfumeDetails.workId, { onDelete: "cascade" }),
    concentration: text("concentration", { enum: PERFUME_CONCENTRATIONS }),
    concentrationLabel: text("concentration_label"),
    formulationLabel: text("formulation_label"),
    perfumersOverride: boolean("perfumers_override").notNull().default(false),
    ...releaseDates(),
    sourceRecordId: source(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("perfume_variant_identity_unique")
      .on(t.workId, t.concentration, t.concentrationLabel, t.formulationLabel)
      .nullsNotDistinct(),
    check(
      "perfume_variant_concentration_check",
      sql`${t.concentration} is null or ${t.concentration} in ('extrait','parfum','eau_de_parfum','eau_de_toilette','eau_de_cologne','eau_fraiche','oil','other')`,
    ),
    check(
      "perfume_variant_label_check",
      sql`(${t.concentrationLabel} is null or length(trim(${t.concentrationLabel})) between 1 and 200) and (${t.formulationLabel} is null or length(trim(${t.formulationLabel})) between 1 and 200) and (${t.concentration} is distinct from 'other' or ${t.concentrationLabel} is not null)`,
    ),
    index("perfume_variant_work_idx").on(t.workId),
  ],
);
/** Explicit formulation attribution can replace the fragrance's perfumers. */
export const perfumeVariantPerfumers = pgTable(
  "perfume_variant_perfumers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => perfumeVariants.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => authors.id, {
      onDelete: "restrict",
    }),
    creditedAs: text("credited_as"),
    attribution: attributionEnum("attribution")
      .notNull()
      .default("unspecified"),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    sourceRecordId: source(),
  },
  (t) => [
    index("perfume_variant_perfumer_order_idx").on(
      t.variantId,
      t.sortOrder,
      t.id,
    ),
    index("perfume_variant_perfumer_person_idx").on(t.personId),
    check(
      "perfume_variant_perfumer_check",
      sql`${t.sortOrder}>=0 and (${t.personId} is not null or coalesce(length(trim(${t.creditedAs})),0)>0 or ${t.attribution} in ('anonymous','unknown'))`,
    ),
  ],
);
export const perfumeOrganizations = pgTable(
  "perfume_organizations",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => perfumeDetails.workId, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => publishingHouses.id, { onDelete: "restrict" }),
    role: text("role", { enum: PERFUME_ORGANIZATION_ROLES }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceRecordId: source(),
  },
  (t) => [
    primaryKey({ columns: [t.workId, t.organizationId, t.role] }),
    index("perfume_organization_idx").on(t.organizationId, t.role),
    check(
      "perfume_organization_role_check",
      sql`${t.role} in ('perfume_house','brand','manufacturer') and ${t.sortOrder}>=0`,
    ),
  ],
);
export const perfumeVariantOverrides = pgTable(
  "perfume_variant_overrides",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => perfumeVariants.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => taxonomyFamilies.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.familyId] }),
    index("perfume_override_family_idx").on(t.familyId),
  ],
);
export const perfumeVariantTaxa = pgTable(
  "perfume_variant_taxa",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => perfumeVariants.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => customTaxonomyItems.id, { onDelete: "restrict" }),
    sourceRecordId: source(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.itemId] }),
    index("perfume_variant_taxon_idx").on(t.itemId),
  ],
);
const noteFields = () => ({
  itemId: uuid("item_id")
    .notNull()
    .references(() => customTaxonomyItems.id, { onDelete: "restrict" }),
  position: text("position", { enum: NOTE_POSITIONS })
    .notNull()
    .default("unspecified"),
  sortOrder: integer("sort_order").notNull().default(0),
  sourceRecordId: source(),
});
export const perfumeNotes = pgTable(
  "perfume_notes",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => perfumeDetails.workId, { onDelete: "cascade" }),
    ...noteFields(),
  },
  (t) => [
    primaryKey({ columns: [t.workId, t.itemId, t.position] }),
    index("perfume_note_item_idx").on(t.itemId),
    check(
      "perfume_note_position_check",
      sql`${t.position} in ('top','heart','base','unspecified') and ${t.sortOrder}>=0`,
    ),
  ],
);
export const perfumeVariantNotes = pgTable(
  "perfume_variant_notes",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => perfumeVariants.id, { onDelete: "cascade" }),
    ...noteFields(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.itemId, t.position] }),
    index("perfume_variant_note_item_idx").on(t.itemId),
    check(
      "perfume_variant_note_position_check",
      sql`${t.position} in ('top','heart','base','unspecified') and ${t.sortOrder}>=0`,
    ),
  ],
);
export const perfumeBottles = pgTable(
  "perfume_bottles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => perfumeVariants.id, { onDelete: "restrict" }),
    container: text("container", { enum: PERFUME_CONTAINERS }).notNull(),
    capacityValue: numeric("capacity_value", {
      precision: 15,
      scale: 6,
      mode: "number",
    }).notNull(),
    volumeUnit: text("volume_unit", { enum: ["ml", "l"] }).notNull(),
    capacityMl: numeric("capacity_ml", {
      precision: 15,
      scale: 3,
      mode: "number",
    }).generatedAlwaysAs(
      sql`capacity_value * case volume_unit when 'l' then 1000 else 1 end`,
    ),
    remainingMl: numeric("remaining_ml", {
      precision: 15,
      scale: 3,
      mode: "number",
    }),
    status: text("status", { enum: PERSONAL_HOLDING_STATUSES })
      .notNull()
      .default("held"),
    batchCode: text("batch_code"),
    condition: text("condition"),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    subLocationId: uuid("sub_location_id").references(() => subLocations.id, {
      onDelete: "restrict",
    }),
    acquisitionDateId: uuid("acquisition_date_id").references(
      () => catalogueDates.id,
    ),
    supplierId: uuid("supplier_id").references(() => publishingHouses.id, {
      onDelete: "restrict",
    }),
    venueId: uuid("venue_id").references(() => venues.id, {
      onDelete: "restrict",
    }),
    acquisitionPrice: numeric("acquisition_price", {
      precision: 11,
      scale: 2,
      mode: "number",
    }),
    acquisitionCurrency: text("acquisition_currency"),
    dispositionDateId: uuid("disposition_date_id").references(
      () => catalogueDates.id,
    ),
    dispositionReason: text("disposition_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("perfume_bottle_variant_idx").on(t.variantId),
    index("perfume_bottle_location_idx").on(t.locationId),
    index("perfume_bottle_supplier_idx").on(t.supplierId),
    index("perfume_bottle_venue_idx").on(t.venueId),
    check(
      "perfume_bottle_quantity_check",
      sql`${t.capacityValue}>0 and ${t.capacityValue}<=1000000 and ${t.volumeUnit} in ('ml','l') and (${t.remainingMl} is null or (${t.remainingMl}>=0 and ${t.remainingMl}<=${t.capacityMl}))`,
    ),
    check(
      "perfume_bottle_kind_check",
      sql`${t.container} in ('bottle','sample','decant') and ${t.status} in ('held','lent_out','in_storage','missing','disposed')`,
    ),
    check(
      "perfume_bottle_location_check",
      sql`${t.subLocationId} is null or ${t.locationId} is not null`,
    ),
    check(
      "perfume_bottle_price_check",
      sql`(${t.acquisitionPrice} is null and ${t.acquisitionCurrency} is null) or (${t.acquisitionPrice} is not null and ${t.acquisitionPrice}>=0 and ${t.acquisitionPrice}<=999999999.99 and ${t.acquisitionCurrency} is not null and ${t.acquisitionCurrency} ~ '^[A-Z]{3}$')`,
    ),
    check(
      "perfume_bottle_disposition_check",
      sql`${t.status}='disposed' or (${t.dispositionDateId} is null and ${t.dispositionReason} is null)`,
    ),
  ],
);
export const perfumeDetailsRelations = relations(
  perfumeDetails,
  ({ one, many }) => ({
    work: one(works, {
      fields: [perfumeDetails.workId],
      references: [works.id],
    }),
    variants: many(perfumeVariants),
    organizations: many(perfumeOrganizations),
    notes: many(perfumeNotes),
  }),
);
export const perfumeVariantsRelations = relations(
  perfumeVariants,
  ({ one, many }) => ({
    perfume: one(perfumeDetails, {
      fields: [perfumeVariants.workId],
      references: [perfumeDetails.workId],
    }),
    bottles: many(perfumeBottles),
    overrides: many(perfumeVariantOverrides),
    taxa: many(perfumeVariantTaxa),
    notes: many(perfumeVariantNotes),
    perfumers: many(perfumeVariantPerfumers),
  }),
);
export const perfumeBottlesRelations = relations(perfumeBottles, ({ one }) => ({
  variant: one(perfumeVariants, {
    fields: [perfumeBottles.variantId],
    references: [perfumeVariants.id],
  }),
}));
export const perfumeVariantPerfumersRelations = relations(
  perfumeVariantPerfumers,
  ({ one }) => ({
    variant: one(perfumeVariants, {
      fields: [perfumeVariantPerfumers.variantId],
      references: [perfumeVariants.id],
    }),
    person: one(authors, {
      fields: [perfumeVariantPerfumers.personId],
      references: [authors.id],
    }),
  }),
);

export const perfumeOrganizationsRelations = relations(
  perfumeOrganizations,
  ({ one }) => ({
    perfume: one(perfumeDetails, {
      fields: [perfumeOrganizations.workId],
      references: [perfumeDetails.workId],
    }),
    organization: one(publishingHouses, {
      fields: [perfumeOrganizations.organizationId],
      references: [publishingHouses.id],
    }),
  }),
);
export const perfumeNotesRelations = relations(perfumeNotes, ({ one }) => ({
  perfume: one(perfumeDetails, {
    fields: [perfumeNotes.workId],
    references: [perfumeDetails.workId],
  }),
  item: one(customTaxonomyItems, {
    fields: [perfumeNotes.itemId],
    references: [customTaxonomyItems.id],
  }),
}));
export const perfumeVariantNotesRelations = relations(
  perfumeVariantNotes,
  ({ one }) => ({
    variant: one(perfumeVariants, {
      fields: [perfumeVariantNotes.variantId],
      references: [perfumeVariants.id],
    }),
    item: one(customTaxonomyItems, {
      fields: [perfumeVariantNotes.itemId],
      references: [customTaxonomyItems.id],
    }),
  }),
);
export const perfumeVariantTaxaRelations = relations(
  perfumeVariantTaxa,
  ({ one }) => ({
    variant: one(perfumeVariants, {
      fields: [perfumeVariantTaxa.variantId],
      references: [perfumeVariants.id],
    }),
    item: one(customTaxonomyItems, {
      fields: [perfumeVariantTaxa.itemId],
      references: [customTaxonomyItems.id],
    }),
  }),
);
export const perfumeVariantOverridesRelations = relations(
  perfumeVariantOverrides,
  ({ one }) => ({
    variant: one(perfumeVariants, {
      fields: [perfumeVariantOverrides.variantId],
      references: [perfumeVariants.id],
    }),
    family: one(taxonomyFamilies, {
      fields: [perfumeVariantOverrides.familyId],
      references: [taxonomyFamilies.id],
    }),
  }),
);
