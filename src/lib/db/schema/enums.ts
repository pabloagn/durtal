import { pgEnum } from "drizzle-orm/pg-core";

// ── Author-level enums ──────────────────────────────────────────────────────

export const genderEnum = pgEnum("gender_enum", ["male", "female"]);

// ── Work-level enums ─────────────────────────────────────────────────────────

export const catalogueStatusEnum = pgEnum("catalogue_status_enum", [
  "tracked",
  "shortlisted",
  "wanted",
  "on_order",
  "accessioned",
  "deaccessioned",
]);

export const acquisitionPriorityEnum = pgEnum("acquisition_priority_enum", [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
]);

// ── Instance-level enums ─────────────────────────────────────────────────────

export const instanceStatusEnum = pgEnum("instance_status_enum", [
  "available",
  "lent_out",
  "in_transit",
  "in_storage",
  "missing",
  "damaged",
  "deaccessioned",
]);

export const dispositionTypeEnum = pgEnum("disposition_type_enum", [
  "sold",
  "donated",
  "gifted",
  "traded",
  "lost",
  "stolen",
  "destroyed",
  "returned",
  "expired",
]);

// ── Venue-level enums ─────────────────────────────────────────────────────────

export const venueTypeEnum = pgEnum("venue_type_enum", [
  "bookshop",
  "online_store",
  "cafe",
  "library",
  "museum",
  "gallery",
  "auction_house",
  "market",
  "fair",
  "publisher",
  "individual",
  "other",
]);

// ── Order-level enums ─────────────────────────────────────────────────────────

export const orderStatusEnum = pgEnum("order_status_enum", [
  "placed",
  "confirmed",
  "processing",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "purchased",
  "received",
  "bid",
  "won",
  "cancelled",
  "returned",
]);

export const acquisitionMethodEnum = pgEnum("acquisition_method_enum", [
  "online_order",
  "in_store_purchase",
  "gift",
  "digital_purchase",
  "auction",
  "event_purchase",
]);
