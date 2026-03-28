import {
  pgTable,
  uuid,
  text,
  boolean,
  date,
  integer,
  numeric,
  bigint,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { editions } from "./editions";
import { locations, subLocations } from "./locations";
import { instanceStatusEnum, dispositionTypeEnum } from "./enums";
import { instanceStatusHistory } from "./instance-status-history";

export const instances = pgTable("instances", {
  id: uuid("id").defaultRandom().primaryKey(),
  editionId: uuid("edition_id")
    .notNull()
    .references(() => editions.id, { onDelete: "cascade" }),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" }),
  subLocationId: uuid("sub_location_id").references(() => subLocations.id, {
    onDelete: "set null",
  }),

  // Lifecycle status
  status: instanceStatusEnum("status").notNull().default("available"),

  // Format
  format: text("format"),

  // Condition (physical)
  condition: text("condition"),
  hasDustJacket: boolean("has_dust_jacket"),
  hasSlipcase: boolean("has_slipcase"),
  conditionNotes: text("condition_notes"),

  // Collector details
  isSigned: boolean("is_signed").notNull().default(false),
  signedBy: text("signed_by"),
  inscription: text("inscription"),
  isFirstPrinting: boolean("is_first_printing").notNull().default(false),
  provenance: text("provenance"),

  // Acquisition
  acquisitionType: text("acquisition_type"),
  acquisitionDate: date("acquisition_date"),
  acquisitionSource: text("acquisition_source"),
  acquisitionPrice: numeric("acquisition_price", { precision: 10, scale: 2 }),
  acquisitionCurrency: text("acquisition_currency"),

  // Digital-specific
  calibreId: integer("calibre_id"),
  calibreUrl: text("calibre_url"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),

  // Disposition (populated when status = 'deaccessioned')
  dispositionType: dispositionTypeEnum("disposition_type"),
  dispositionDate: date("disposition_date"),
  dispositionTo: text("disposition_to"),
  dispositionPrice: numeric("disposition_price", { precision: 10, scale: 2 }),
  dispositionCurrency: text("disposition_currency"),
  dispositionNotes: text("disposition_notes"),

  // Personal
  notes: text("notes"),
  lentTo: text("lent_to"),
  lentDate: date("lent_date"),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const instancesRelations = relations(instances, ({ one, many }) => ({
  edition: one(editions, {
    fields: [instances.editionId],
    references: [editions.id],
  }),
  location: one(locations, {
    fields: [instances.locationId],
    references: [locations.id],
  }),
  subLocation: one(subLocations, {
    fields: [instances.subLocationId],
    references: [subLocations.id],
  }),
  statusHistory: many(instanceStatusHistory),
}));
