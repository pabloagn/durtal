import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, numeric, unique, index, check } from "drizzle-orm/pg-core";
import { perfumeDetails, perfumeVariants } from "./perfumes";
import { publishingHouses } from "./publishing-houses";
import { venues } from "./venues";
import { sourceRecords } from "./provenance";
import { RETAILER_AVAILABILITY } from "@/lib/catalogue/retailers";
import { PERFUME_CONTAINERS } from "@/lib/catalogue/perfumes";

export const perfumeRetailerLinks = pgTable("perfume_retailer_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  workId: uuid("work_id").notNull().references(() => perfumeDetails.workId, { onDelete: "restrict" }),
  variantId: uuid("variant_id").references(() => perfumeVariants.id, { onDelete: "restrict" }),
  organizationId: uuid("organization_id").notNull().references(() => publishingHouses.id, { onDelete: "restrict" }),
  venueId: uuid("venue_id").references(() => venues.id, { onDelete: "restrict" }),
  url: text("url").notNull(),
  sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique("perfume_retailer_identity_unique").on(t.workId, t.variantId, t.organizationId, t.venueId, t.url).nullsNotDistinct(),
  index("perfume_retailer_work_idx").on(t.workId, t.id),
  index("perfume_retailer_variant_idx").on(t.variantId),
  index("perfume_retailer_org_idx").on(t.organizationId),
  index("perfume_retailer_venue_idx").on(t.venueId),
  check("perfume_retailer_url_check", sql`length(${t.url}) between 1 and 4000 and ${t.url} ~ '^https?://[^[:space:]@/]+([/:?#][^[:space:]]*)?$'`),
]);
export const perfumeRetailerObservations = pgTable("perfume_retailer_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  linkId: uuid("link_id").notNull().references(() => perfumeRetailerLinks.id, { onDelete: "restrict" }),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  availability: text("availability", { enum: RETAILER_AVAILABILITY }).notNull().default("unknown"),
  price: numeric("price", { precision: 11, scale: 2, mode: "number" }),
  currency: text("currency"),
  container: text("container", { enum: PERFUME_CONTAINERS }),
  capacityMl: numeric("capacity_ml", { precision: 12, scale: 3, mode: "number" }),
  packageLabel: text("package_label"),
  sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id),
  notes: text("notes"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("perfume_retailer_observation_date_idx").on(t.linkId, t.checkedAt.desc(), t.recordedAt.desc(), t.id),
  check("perfume_retailer_availability_check", sql`${t.availability} in ('unknown','in_stock','out_of_stock','preorder','discontinued','unlisted')`),
  check("perfume_retailer_price_check", sql`(${t.price} is null and ${t.currency} is null) or (${t.price} is not null and ${t.price} between 0 and 999999999.99 and ${t.currency} is not null and ${t.currency} ~ '^[A-Z]{3}$')`),
  check("perfume_retailer_container_check", sql`(${t.container} is null or ${t.container} in ('bottle','sample','decant')) and (${t.capacityMl} is null or (${t.container} is not null and ${t.capacityMl}>0 and ${t.capacityMl}<=1000000))`),
  check("perfume_retailer_checked_at_check", sql`isfinite(${t.checkedAt}) and ${t.checkedAt} <= ${t.recordedAt} + interval '5 minutes'`),
]);
