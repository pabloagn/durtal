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
