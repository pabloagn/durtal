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
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { works } from "./works";
import { authors } from "./authors";
import { attributionEnum } from "./enums";
import { catalogueDates, sourceRecords } from "./provenance";
import { publishingHouses } from "./publishing-houses";
import { customTaxonomyItems } from "./taxonomy-families";
import { locations, subLocations } from "./locations";
import { venues } from "./venues";
import {
  ART_OBJECT_KINDS,
  ART_OWNERSHIPS,
  DIMENSION_UNITS,
} from "@/lib/catalogue/paintings";
import { PERSONAL_HOLDING_STATUSES } from "@/lib/catalogue/holdings";

const source = () =>
  uuid("source_record_id").references(() => sourceRecords.id);
/** A stored dimension converted to centimetres, for sorting and aspect ratios. */
function centimetres(column: "height" | "width") {
  return sql.raw(
    `${column} * case dimension_unit when 'mm' then 0.1 when 'in' then 2.54 else 1 end`,
  );
}

/** One profile per painting work. The painter is a shared `work_credits` row. */
export const paintingDetails = pgTable("painting_details", {
  workId: uuid("work_id")
    .primaryKey()
    .references(() => works.id, { onDelete: "cascade" }),
  /** When the work was made, at any known precision or as a range. */
  creationDateId: uuid("creation_date_id").references(() => catalogueDates.id),
  sourceRecordId: source(),
});

/**
 * An identifiable physical object of a painting: an original, an identified
 * version or a reproduction. Ownership is recorded here; where the object is
 * physically kept is a separate, dated record.
 */
export const artObjects = pgTable(
  "art_objects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => paintingDetails.workId, { onDelete: "cascade" }),
    kind: text("kind", { enum: ART_OBJECT_KINDS }).notNull(),
    /** "Louvre version", "1910 tempera"; distinguishes several originals. */
    label: text("label"),
    /** The original or version a reproduction reproduces, when known. */
    reproducesObjectId: uuid("reproduces_object_id").references(
      (): AnyPgColumn => artObjects.id,
      { onDelete: "restrict" },
    ),
    creationDateId: uuid("creation_date_id").references(
      () => catalogueDates.id,
    ),
    /** Unknown dimensions stay null; the unit applies to all three. */
    height: numeric("height", { precision: 10, scale: 3, mode: "number" }),
    width: numeric("width", { precision: 10, scale: 3, mode: "number" }),
    depth: numeric("depth", { precision: 10, scale: 3, mode: "number" }),
    dimensionUnit: text("dimension_unit", { enum: DIMENSION_UNITS }),
    dimensionsNote: text("dimensions_note"),
    heightCm: numeric("height_cm", {
      precision: 14,
      scale: 4,
      mode: "number",
    }).generatedAlwaysAs(centimetres("height")),
    widthCm: numeric("width_cm", {
      precision: 14,
      scale: 4,
      mode: "number",
    }).generatedAlwaysAs(centimetres("width")),
    /** True when this object's attribution replaces the painting's painters. */
    attributionOverride: boolean("attribution_override")
      .notNull()
      .default(false),
    ownership: text("ownership", { enum: ART_OWNERSHIPS })
      .notNull()
      .default("unknown"),
    ownerOrganizationId: uuid("owner_organization_id").references(
      () => publishingHouses.id,
      { onDelete: "restrict" },
    ),
    /** A private owner's description, such as "Private collection, Zurich". */
    ownerLabel: text("owner_label"),
    /** The owning institution's collection or department. */
    collectionName: text("collection_name"),
    /** Unique within the owning institution only. */
    accessionNumber: text("accession_number"),
    // Personal holding: only for objects the collector owns.
    holdingStatus: text("holding_status", { enum: PERSONAL_HOLDING_STATUSES }),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    subLocationId: uuid("sub_location_id").references(() => subLocations.id, {
      onDelete: "restrict",
    }),
    acquisitionDateId: uuid("acquisition_date_id").references(
      () => catalogueDates.id,
    ),
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
    sourceRecordId: source(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("art_object_work_idx").on(t.workId, t.createdAt, t.id),
    index("art_object_reproduces_idx").on(t.reproducesObjectId),
    index("art_object_owner_idx").on(t.ownerOrganizationId),
    index("art_object_location_idx").on(t.locationId),
    index("art_object_venue_idx").on(t.venueId),
    // Originals and versions of one painting need distinct labels.
    uniqueIndex("art_object_identity_unique")
      .on(t.workId, sql`coalesce(${t.label}, '')`)
      .where(sql`${t.kind} <> 'reproduction'`),
    uniqueIndex("art_object_accession_unique")
      .on(t.ownerOrganizationId, sql`lower(btrim(${t.accessionNumber}))`)
      .where(sql`${t.accessionNumber} is not null`),
    check(
      "art_object_kind_check",
      sql`${t.kind} in ('original','version','reproduction') and (${t.reproducesObjectId} is null or ${t.kind}='reproduction') and (${t.label} is null or length(trim(${t.label})) between 1 and 200)`,
    ),
    check(
      "art_object_dimension_check",
      sql`(${t.height} is null or ${t.height} between 0.001 and 100000) and (${t.width} is null or ${t.width} between 0.001 and 100000) and (${t.depth} is null or ${t.depth} between 0.001 and 100000)
        and (${t.dimensionUnit} is null) = (${t.height} is null and ${t.width} is null and ${t.depth} is null)
        and (${t.dimensionUnit} is null or ${t.dimensionUnit} in ('mm','cm','in'))
        and (${t.dimensionsNote} is null or length(trim(${t.dimensionsNote})) between 1 and 500)`,
    ),
    check(
      "art_object_ownership_check",
      sql`${t.ownership} in ('institutional','private','personal','unknown')
        and (${t.ownership}='institutional') = (${t.ownerOrganizationId} is not null)
        and (${t.ownerLabel} is null or (${t.ownership}='private' and length(trim(${t.ownerLabel})) between 1 and 300))
        and ((${t.collectionName} is null and ${t.accessionNumber} is null) or ${t.ownership}='institutional')
        and (${t.collectionName} is null or length(trim(${t.collectionName})) between 1 and 300)
        and (${t.accessionNumber} is null or length(trim(${t.accessionNumber})) between 1 and 200)`,
    ),
    check(
      "art_object_holding_check",
      sql`(${t.ownership}='personal') = (${t.holdingStatus} is not null)
        and (${t.holdingStatus} is null or ${t.holdingStatus} in ('held','lent_out','in_storage','missing','disposed'))
        and (${t.ownership}='personal' or (${t.locationId} is null and ${t.subLocationId} is null and ${t.acquisitionDateId} is null and ${t.venueId} is null and ${t.acquisitionPrice} is null and ${t.dispositionDateId} is null and ${t.dispositionReason} is null))
        and (${t.subLocationId} is null or ${t.locationId} is not null)
        and ((${t.acquisitionPrice} is null and ${t.acquisitionCurrency} is null) or (${t.acquisitionPrice} is not null and ${t.acquisitionPrice}>=0 and ${t.acquisitionPrice}<=999999999.99 and ${t.acquisitionCurrency} is not null and ${t.acquisitionCurrency} ~ '^[A-Z]{3}$'))
        and (${t.holdingStatus}='disposed' or (${t.dispositionDateId} is null and ${t.dispositionReason} is null))`,
    ),
  ],
);
/** Object-level attribution; replaces the painting's painters when declared. */
export const artObjectCredits = pgTable(
  "art_object_credits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    objectId: uuid("object_id")
      .notNull()
      .references(() => artObjects.id, { onDelete: "cascade" }),
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
    index("art_object_credit_order_idx").on(t.objectId, t.sortOrder, t.id),
    index("art_object_credit_person_idx").on(t.personId),
    check(
      "art_object_credit_check",
      sql`${t.sortOrder}>=0 and (${t.personId} is not null or coalesce(length(trim(${t.creditedAs})),0)>0 or ${t.attribution} in ('anonymous','unknown'))`,
    ),
  ],
);
/** Object-level technique, medium and support; present values replace the painting's. */
export const artObjectTaxa = pgTable(
  "art_object_taxa",
  {
    objectId: uuid("object_id")
      .notNull()
      .references(() => artObjects.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => customTaxonomyItems.id, { onDelete: "restrict" }),
    sourceRecordId: source(),
  },
  (t) => [
    primaryKey({ columns: [t.objectId, t.itemId] }),
    index("art_object_taxon_idx").on(t.itemId),
  ],
);

export const paintingDetailsRelations = relations(
  paintingDetails,
  ({ one, many }) => ({
    work: one(works, {
      fields: [paintingDetails.workId],
      references: [works.id],
    }),
    objects: many(artObjects),
  }),
);
export const artObjectsRelations = relations(artObjects, ({ one, many }) => ({
  painting: one(paintingDetails, {
    fields: [artObjects.workId],
    references: [paintingDetails.workId],
  }),
  reproduces: one(artObjects, {
    fields: [artObjects.reproducesObjectId],
    references: [artObjects.id],
  }),
  owner: one(publishingHouses, {
    fields: [artObjects.ownerOrganizationId],
    references: [publishingHouses.id],
  }),
  credits: many(artObjectCredits),
  taxa: many(artObjectTaxa),
}));
export const artObjectCreditsRelations = relations(
  artObjectCredits,
  ({ one }) => ({
    object: one(artObjects, {
      fields: [artObjectCredits.objectId],
      references: [artObjects.id],
    }),
    person: one(authors, {
      fields: [artObjectCredits.personId],
      references: [authors.id],
    }),
  }),
);
export const artObjectTaxaRelations = relations(artObjectTaxa, ({ one }) => ({
  object: one(artObjects, {
    fields: [artObjectTaxa.objectId],
    references: [artObjects.id],
  }),
  item: one(customTaxonomyItems, {
    fields: [artObjectTaxa.itemId],
    references: [customTaxonomyItems.id],
  }),
}));
