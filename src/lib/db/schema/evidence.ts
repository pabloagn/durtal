import { sql } from "drizzle-orm";
import { pgTable, uuid, text, numeric, date, integer, timestamp, jsonb, check, index } from "drizzle-orm/pg-core";
import { works } from "./works";
import { enrichmentJobs } from "./enrichment";
import { FETCH_POLICIES, OUTLET_KINDS, OUTLET_STATUSES, RESERVED_OUTLET_KEYS } from "@/lib/enrichment/outlets";
import { sqlList } from "@/lib/enrichment/model";

/*
 * The evidence store's registry and the cost meter (SLN-468). Evidence
 * documents themselves are `source_records` rows (payload.kind
 * 'evidence_page' or 'evidence_text'); their text is in the private S3
 * prefix bronze/evidence/. The guards that compare rows are triggers in
 * migration 0078 (docs/02, "Evidence store and cost meter").
 */

export const COST_STATUSES = ["reserved", "settled", "released"] as const;

/** The outlets whose pages may serve as evidence, with weights and fetch policies */
export const evidenceOutlets = pgTable(
  "evidence_outlets",
  {
    /** A slug with no dot, never a reserved provider name */
    key: text("key").primaryKey(),
    name: text("name").notNull(),
    /** Lowercase host names; a domain matches itself and its subdomains */
    domains: text("domains").array().notNull(),
    kind: text("kind", { enum: OUTLET_KINDS }).notNull(),
    /** ISO 639-1; null when the outlet writes in several */
    language: text("language"),
    weight: numeric("weight", { precision: 4, scale: 3, mode: "number" }).notNull(),
    /** Outlets of one group count as one source (R6); null counts alone */
    syndicationGroup: text("syndication_group"),
    fetchPolicy: text("fetch_policy", { enum: FETCH_POLICIES }).notNull(),
    termsUrl: text("terms_url"),
    termsCheckedOn: date("terms_checked_on"),
    termsNote: text("terms_note"),
    status: text("status", { enum: OUTLET_STATUSES }).notNull().default("active"),
    seedVersion: integer("seed_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check(
      "evidence_outlet_value_check",
      sql.raw(
        `key ~ '^[a-z0-9]+([_-][a-z0-9]+)*$' and length(key) <= 100 and key not in (${sqlList(RESERVED_OUTLET_KEYS)}) and length(trim(name)) between 1 and 200 and cardinality(domains) between 1 and 20 and kind in (${sqlList(OUTLET_KINDS)}) and (language is null or language ~ '^[a-z]{2}$') and weight between 0 and 1 and (syndication_group is null or syndication_group ~ '^[a-z0-9]+([_-][a-z0-9]+)*$') and status in (${sqlList(OUTLET_STATUSES)}) and seed_version >= 1 and (terms_url is null or (terms_url ~ '^https?://' and length(terms_url) <= 4000)) and (terms_note is null or length(terms_note) <= 500)`,
      ),
    ),
    check(
      "evidence_outlet_policy_check",
      sql.raw(`fetch_policy in (${sqlList(FETCH_POLICIES)}) and (fetch_policy <> 'fetch' or terms_checked_on is not null)`),
    ),
  ],
);

/** The ledger of metered calls: reserved before a call, settled or released after; never deleted */
export const enrichmentCosts = pgTable(
  "enrichment_costs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    status: text("status", { enum: COST_STATUSES }).notNull().default("reserved"),
    /** Unit name to count, such as input and output tokens */
    estimatedUnits: jsonb("estimated_units").$type<Record<string, number>>().notNull(),
    units: jsonb("units").$type<Record<string, number>>(),
    estimatedCostUsd: numeric("estimated_cost_usd", { mode: "number" }).notNull(),
    costUsd: numeric("cost_usd", { mode: "number" }),
    priceVersion: text("price_version").notNull(),
    workId: uuid("work_id").references(() => works.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => enrichmentJobs.id, { onDelete: "set null" }),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "enrichment_cost_value_check",
      sql.raw(
        `provider ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and length(provider) <= 100 and length(trim(operation)) between 1 and 100 and status in (${sqlList(COST_STATUSES)}) and jsonb_typeof(estimated_units) = 'object' and (units is null or jsonb_typeof(units) = 'object') and estimated_cost_usd >= 0 and (cost_usd is null or cost_usd >= 0) and length(trim(price_version)) between 1 and 100`,
      ),
    ),
    check(
      "enrichment_cost_state_check",
      sql.raw(
        `(status = 'reserved' and settled_at is null and cost_usd is null and units is null) or (status = 'settled' and settled_at is not null and cost_usd is not null and units is not null) or (status = 'released' and settled_at is not null and cost_usd is null)`,
      ),
    ),
    index("enrichment_cost_created_idx").on(t.createdAt),
    index("enrichment_cost_run_idx").on(t.runId),
    index("enrichment_cost_job_idx").on(t.jobId),
    index("enrichment_cost_work_idx").on(t.workId),
  ],
);
