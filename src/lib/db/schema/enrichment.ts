import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  smallint,
  integer,
  boolean,
  numeric,
  date,
  timestamp,
  jsonb,
  check,
  unique,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { works } from "./works";
import { editions } from "./editions";
import { authors } from "./authors";
import { places } from "./places";
import { workTypes } from "./work-types";
import { taxonomyFamilies, customTaxonomyItems } from "./taxonomy-families";
import { sourceRecords } from "./provenance";
import {
  APPLY_TARGET_RULES,
  APPLIED_BY,
  CLAIM_DECIDERS,
  CLAIM_METHODS,
  CLAIM_STATUSES,
  DECISION_REASONS,
  ENRICHMENT_APPLY_TARGETS,
  ENRICHMENT_ENTITY_LEVELS,
  ENRICHMENT_LAYERS,
  ENRICHMENT_VALUE_KINDS,
  EVIDENCE_LOCATORS,
  GATE_PRECISION,
  JOB_HELD_REASONS,
  JOB_KINDS,
  JOB_STATUSES,
  MAX_EXCERPT_LENGTH,
  OPEN_JOB_STATUSES,
  RULE_BASES,
  UNKNOWN_HANDLING,
  sqlList,
} from "@/lib/enrichment/model";

/*
 * Book enrichment (SLN-462): proposed values with their evidence, the
 * approved vocabulary that governs taxonomy items, the accepted values that
 * have no column, the apply log with undo, auto-accept rules, popularity
 * snapshots and the job queue. Accepted terms live in the taxonomy junction
 * tables, not here. The guards that need other tables are triggers in
 * migration 0077 (docs/02, "Book enrichment").
 */

const SLUG = "'^[a-z0-9]+([_-][a-z0-9]+)*$'";
const SHA256 = "'^[a-f0-9]{64}$'";
const PROVIDER = "'^[a-z0-9]+([._-][a-z0-9]+)*$'";
const HTTPS = "'^https://[^[:space:]]+$'";
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One approved vocabulary, loaded from its seed file */
export const enrichmentVocabularyVersions = pgTable(
  "enrichment_vocabulary_versions",
  {
    version: smallint("version").primaryKey(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    /** Pablo's approval comment on SLN-461 */
    approvalUrl: text("approval_url").notNull(),
    /** The "Book enrichment vocabulary" document */
    documentUrl: text("document_url"),
    seedSha256: text("seed_sha256").notNull(),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => [
    check(
      "enrichment_vocabulary_version_check",
      sql`${t.version} >= 1 and ${t.approvalUrl} ~ ${sql.raw(HTTPS)} and (${t.documentUrl} is null or ${t.documentUrl} ~ ${sql.raw(HTTPS)}) and ${t.seedSha256} ~ ${sql.raw(SHA256)}`,
    ),
  ],
);

const targetKindCheck = Object.entries(APPLY_TARGET_RULES)
  .map(
    ([target, rule]) =>
      `(apply_target = '${target}' and value_kind in (${sqlList(rule.kinds)}) and entity_level in (${sqlList(rule.levels)}))`,
  )
  .join(" or ");

/** One thing a book is described by: a layer, a value kind and where it is applied */
export const enrichmentDimensions = pgTable(
  "enrichment_dimensions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull().unique(),
    label: text("label").notNull(),
    definition: text("definition").notNull(),
    layer: text("layer", { enum: ENRICHMENT_LAYERS }).notNull(),
    valueKind: text("value_kind", { enum: ENRICHMENT_VALUE_KINDS }).notNull(),
    entityLevel: text("entity_level", { enum: ENRICHMENT_ENTITY_LEVELS }).notNull().default("work"),
    /** Set exactly for identifier dimensions */
    provider: text("provider"),
    applyTarget: text("apply_target", { enum: ENRICHMENT_APPLY_TARGETS }).notNull(),
    /** The taxonomy family a term, terms or scale dimension writes into */
    taxonomyFamilyId: uuid("taxonomy_family_id").references(() => taxonomyFamilies.id, {
      onDelete: "restrict",
    }),
    /** For the attributes family: the category its items share */
    attributeCategory: text("attribute_category"),
    requiresIndependentSources: boolean("requires_independent_sources").notNull().default(false),
    /** Whether an auto-accept rule may ever exist for this dimension */
    autoAcceptEligible: boolean("auto_accept_eligible").notNull().default(false),
    unknownHandling: text("unknown_handling", { enum: UNKNOWN_HANDLING }).notNull().default("exclude"),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull().default({}),
    introducedIn: smallint("introduced_in")
      .notNull()
      .references(() => enrichmentVocabularyVersions.version, { onDelete: "restrict" }),
    retiredIn: smallint("retired_in").references(() => enrichmentVocabularyVersions.version, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "enrichment_dimension_value_check",
      sql`${t.key} ~ ${sql.raw(SLUG)} and length(${t.key}) <= 100 and length(trim(${t.label})) between 1 and 200 and length(trim(${t.definition})) between 1 and 4000 and jsonb_typeof(${t.parameters}) = 'object' and (${t.retiredIn} is null or ${t.retiredIn} > ${t.introducedIn})`,
    ),
    check(
      "enrichment_dimension_kind_check",
      sql`${t.layer} in (${sql.raw(sqlList(ENRICHMENT_LAYERS))}) and ${t.valueKind} in (${sql.raw(sqlList(ENRICHMENT_VALUE_KINDS))}) and ${t.unknownHandling} in (${sql.raw(sqlList(UNKNOWN_HANDLING))})`,
    ),
    // Every value kind fits the target it is written to
    check("enrichment_dimension_target_check", sql.raw(`(${targetKindCheck})`)),
    check(
      "enrichment_dimension_provider_check",
      sql`(${t.valueKind} = 'identifier') = (${t.provider} is not null) and (${t.provider} is null or ${t.provider} ~ ${sql.raw(PROVIDER)})`,
    ),
    check(
      "enrichment_dimension_family_check",
      sql`(${t.taxonomyFamilyId} is not null) = (${t.applyTarget} = 'taxonomy') and (${t.attributeCategory} is null or (${t.taxonomyFamilyId} is not null and length(trim(${t.attributeCategory})) between 1 and 100))`,
    ),
  ],
);

/**
 * An approved term or scale anchor: the governance record of one taxonomy
 * item (a custom item, a row of a system family, or a work type)
 */
export const enrichmentTerms = pgTable(
  "enrichment_terms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dimensionId: uuid("dimension_id")
      .notNull()
      .references(() => enrichmentDimensions.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    definition: text("definition").notNull(),
    appliesWhen: text("applies_when").notNull(),
    doesNotApplyWhen: text("does_not_apply_when").notNull(),
    /** `{ workId }` for a book in the catalogue, `{ title, author }` for one outside it */
    examples: jsonb("examples").$type<({ workId: string } | { title: string; author: string })[]>().notNull(),
    scaleValue: numeric("scale_value", { mode: "number" }),
    introducedIn: smallint("introduced_in")
      .notNull()
      .references(() => enrichmentVocabularyVersions.version, { onDelete: "restrict" }),
    retiredIn: smallint("retired_in").references(() => enrichmentVocabularyVersions.version, {
      onDelete: "restrict",
    }),
    replacedByTermId: uuid("replaced_by_term_id").references((): AnyPgColumn => enrichmentTerms.id, {
      onDelete: "no action",
    }),
    customItemId: uuid("custom_item_id").references(() => customTaxonomyItems.id, {
      onDelete: "restrict",
    }),
    /** A row of the dimension family's system table; a trigger checks it */
    systemItemId: uuid("system_item_id"),
    workTypeId: uuid("work_type_id").references(() => workTypes.id, { onDelete: "restrict" }),
    parentTermId: uuid("parent_term_id").references((): AnyPgColumn => enrichmentTerms.id, {
      onDelete: "no action",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "enrichment_term_value_check",
      sql`${t.key} ~ ${sql.raw(SLUG)} and length(${t.key}) <= 100 and length(trim(${t.label})) between 1 and 200 and length(trim(${t.definition})) between 1 and 4000 and length(trim(${t.appliesWhen})) between 1 and 4000 and length(trim(${t.doesNotApplyWhen})) between 1 and 4000 and jsonb_typeof(${t.examples}) = 'array' and (${t.retiredIn} is null or ${t.retiredIn} > ${t.introducedIn}) and ${t.replacedByTermId} is distinct from ${t.id} and ${t.parentTermId} is distinct from ${t.id} and (${t.replacedByTermId} is null or ${t.retiredIn} is not null)`,
    ),
    check(
      "enrichment_term_item_check",
      sql`num_nonnulls(${t.customItemId}, ${t.systemItemId}, ${t.workTypeId}) = 1`,
    ),
    index("enrichment_term_dimension_idx").on(t.dimensionId),
    index("enrichment_term_system_item_idx").on(t.systemItemId),
    index("enrichment_term_custom_item_idx").on(t.customItemId),
  ],
);

/** The job queue: one row per stage of work on one book */
export const enrichmentJobs = pgTable(
  "enrichment_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: JOB_KINDS }).notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
    /** Lower runs first */
    priority: smallint("priority").notNull().default(100),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    heldReason: text("held_reason", { enum: JOB_HELD_REASONS }),
    /** Short, and never a URL with a key, a header or a secret */
    lastError: text("last_error"),
    /** `reason`, the dimension keys, the vocabulary version, and an `outcome` once finished */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Queue again when the running attempt finishes */
    rerun: boolean("rerun").notNull().default(false),
    cost: numeric("cost", { mode: "number" }).notNull().default(0),
    ...timestamps(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "enrichment_job_value_check",
      sql`${t.kind} in (${sql.raw(sqlList(JOB_KINDS))}) and ${t.status} in (${sql.raw(sqlList(JOB_STATUSES))}) and ${t.attempts} >= 0 and ${t.cost} >= 0 and jsonb_typeof(${t.payload}) = 'object' and (${t.lastError} is null or length(${t.lastError}) <= 500)`,
    ),
    check(
      "enrichment_job_state_check",
      sql`(${t.status} = 'running') = (${t.lockedAt} is not null) and (${t.lockedAt} is null) = (${t.lockedBy} is null) and (${t.lockedBy} is null or length(trim(${t.lockedBy})) between 1 and 200) and (${t.status} = 'held') = (${t.heldReason} is not null) and (${t.heldReason} is null or ${t.heldReason} in (${sql.raw(sqlList(JOB_HELD_REASONS))})) and (${t.finishedAt} is not null) = (${t.status} in ('done', 'failed'))`,
    ),
    uniqueIndex("enrichment_job_open_unique")
      .on(t.workId, t.kind)
      .where(sql.raw(`status in (${sqlList(OPEN_JOB_STATUSES)})`)),
    index("enrichment_job_queue_idx").on(t.status, t.priority, t.runAfter),
    // Done and failed jobs pile up: a work's delete or merge finds its jobs here
    index("enrichment_job_work_idx").on(t.workId),
  ],
);

/** An auto-accept rule; every rule ships off (R8) */
export const enrichmentAutoAcceptRules = pgTable(
  "enrichment_auto_accept_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dimensionId: uuid("dimension_id")
      .notNull()
      .unique()
      .references(() => enrichmentDimensions.id, { onDelete: "restrict" }),
    basis: text("basis", { enum: RULE_BASES }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    minimumConfidence: numeric("minimum_confidence", { precision: 4, scale: 3, mode: "number" })
      .notNull()
      .default(1),
    goldSetVersion: integer("gold_set_version"),
    measuredPrecision: numeric("measured_precision", { precision: 5, scale: 4, mode: "number" }),
    sampleSize: integer("sample_size"),
    minimumSample: integer("minimum_sample"),
    gatePassedAt: timestamp("gate_passed_at", { withTimezone: true }),
    /** Pablo's yes */
    approvalUrl: text("approval_url"),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check(
      "enrichment_rule_value_check",
      sql`${t.basis} in (${sql.raw(sqlList(RULE_BASES))}) and ${t.minimumConfidence} between 0 and 1 and (${t.measuredPrecision} is null or ${t.measuredPrecision} between 0 and 1) and (${t.sampleSize} is null or ${t.sampleSize} >= 0) and (${t.minimumSample} is null or ${t.minimumSample} >= 1) and (${t.approvalUrl} is null or ${t.approvalUrl} ~ ${sql.raw(HTTPS)})`,
    ),
    // R8: a rule turns on only with Pablo's yes, and a gated one only past the gate
    check(
      "enrichment_rule_gate_check",
      sql.raw(
        `not enabled or (approval_url is not null and enabled_at is not null and (basis = 'exact_identifier_match' or (measured_precision >= ${GATE_PRECISION} and sample_size >= minimum_sample and gold_set_version is not null and gate_passed_at is not null)))`,
      ),
    ),
  ],
);

/** One proposed value for one dimension of one work */
export const enrichmentClaims = pgTable(
  "enrichment_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    /** Edition-level dimensions only */
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    dimensionId: uuid("dimension_id")
      .notNull()
      .references(() => enrichmentDimensions.id, { onDelete: "restrict" }),
    termId: uuid("term_id").references(() => enrichmentTerms.id, { onDelete: "restrict" }),
    numberValue: numeric("number_value", { mode: "number" }),
    textValue: text("text_value"),
    placeId: uuid("place_id").references(() => places.id, { onDelete: "restrict" }),
    personId: uuid("person_id").references(() => authors.id, { onDelete: "restrict" }),
    method: text("method", { enum: CLAIM_METHODS }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3, mode: "number" }).notNull(),
    vocabularyVersion: smallint("vocabulary_version")
      .notNull()
      .references(() => enrichmentVocabularyVersions.version, { onDelete: "restrict" }),
    status: text("status", { enum: CLAIM_STATUSES }).notNull().default("proposed"),
    decidedBy: text("decided_by", { enum: CLAIM_DECIDERS }),
    ruleId: uuid("rule_id").references(() => enrichmentAutoAcceptRules.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    supersededByClaimId: uuid("superseded_by_claim_id").references((): AnyPgColumn => enrichmentClaims.id, {
      onDelete: "set null",
    }),
    decisionReason: text("decision_reason", { enum: DECISION_REASONS }),
    /** The run that opened it; required for api and agent claims */
    runId: uuid("run_id"),
    jobId: uuid("job_id").references(() => enrichmentJobs.id, { onDelete: "set null" }),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    check(
      "enrichment_claim_value_check",
      sql`num_nonnulls(${t.termId}, ${t.numberValue}, ${t.textValue}, ${t.placeId}, ${t.personId}) between 1 and 2 and (${t.textValue} is null or (${t.textValue} = btrim(${t.textValue}) and length(${t.textValue}) between 1 and 500)) and (${t.note} is null or length(${t.note}) <= 2000)`,
    ),
    check(
      "enrichment_claim_method_check",
      sql`${t.method} in (${sql.raw(sqlList(CLAIM_METHODS))}) and ${t.confidence} between 0 and 1 and (${t.method} <> 'human' or ${t.confidence} = 1) and (${t.method} = 'human' or ${t.runId} is not null)`,
    ),
    check(
      "enrichment_claim_decision_check",
      sql`${t.status} in (${sql.raw(sqlList(CLAIM_STATUSES))}) and (${t.status} = 'proposed') = (${t.decidedAt} is null) and (${t.status} = 'proposed') = (${t.decidedBy} is null) and (${t.decidedBy} is null or ${t.decidedBy} in (${sql.raw(sqlList(CLAIM_DECIDERS))})) and (${t.decidedBy} is not distinct from 'rule') = (${t.ruleId} is not null) and (${t.status} = 'rejected') = (${t.decisionReason} is not null) and (${t.decisionReason} is null or ${t.decisionReason} in (${sql.raw(sqlList(DECISION_REASONS))})) and (${t.status} = 'superseded' or ${t.supersededByClaimId} is null) and ${t.supersededByClaimId} is distinct from ${t.id}`,
    ),
    index("enrichment_claim_work_idx").on(t.workId, t.dimensionId, t.status),
    index("enrichment_claim_dimension_idx").on(t.dimensionId, t.status),
    index("enrichment_claim_edition_idx").on(t.editionId),
    index("enrichment_claim_term_idx").on(t.termId),
    index("enrichment_claim_place_idx").on(t.placeId),
    index("enrichment_claim_person_idx").on(t.personId),
    index("enrichment_claim_run_idx").on(t.runId),
    index("enrichment_claim_job_idx").on(t.jobId),
    index("enrichment_claim_rule_idx").on(t.ruleId),
  ],
);

/** One excerpt that supports one claim; it never changes (R3) */
export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => enrichmentClaims.id, { onDelete: "cascade" }),
    /** A plain key, made DEFERRABLE INITIALLY DEFERRED by migration 0077 */
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id),
    /** The source record's provider */
    outlet: text("outlet").notNull(),
    /** The mapping rule version, or the model and prompt version */
    extractorVersion: text("extractor_version").notNull(),
    /** The run that added this row */
    runId: uuid("run_id"),
    locator: text("locator", { enum: EVIDENCE_LOCATORS }).notNull(),
    excerpt: text("excerpt").notNull(),
    excerptSha256: text("excerpt_sha256").notNull(),
    /** Unicode code points of the stored NFC text */
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    textSha256: text("text_sha256"),
    /** A path into source_records.payload */
    payloadPath: text("payload_path").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("claim_evidence_excerpt_unique").on(t.claimId, t.sourceRecordId, t.excerptSha256),
    check(
      "claim_evidence_value_check",
      sql.raw(
        `outlet ~ ${PROVIDER} and length(outlet) <= 100 and length(trim(extractor_version)) between 1 and 200 and length(excerpt) between 1 and ${MAX_EXCERPT_LENGTH} and excerpt_sha256 = encode(sha256(convert_to(excerpt, 'UTF8')), 'hex')`,
      ),
    ),
    check(
      "claim_evidence_locator_check",
      sql.raw(
        `(locator = 'text' and start_offset >= 0 and end_offset - start_offset = length(excerpt) and text_sha256 ~ ${SHA256} and payload_path is null) or (locator = 'payload' and cardinality(payload_path) >= 1 and start_offset is null and end_offset is null and text_sha256 is null)`,
      ),
    ),
    index("claim_evidence_source_idx").on(t.sourceRecordId),
    index("claim_evidence_run_idx").on(t.runId),
  ],
);

/** Accepted values with no home in the catalogue: setting places and numbers without a column */
export const workEnrichmentValues = pgTable(
  "work_enrichment_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    dimensionId: uuid("dimension_id")
      .notNull()
      .references(() => enrichmentDimensions.id, { onDelete: "restrict" }),
    numberValue: numeric("number_value", { mode: "number" }),
    placeId: uuid("place_id").references(() => places.id, { onDelete: "restrict" }),
    /** The claim that set it */
    claimId: uuid("claim_id")
      .notNull()
      .unique()
      .references(() => enrichmentClaims.id, { onDelete: "cascade" }),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("work_enrichment_value_check", sql`num_nonnulls(${t.numberValue}, ${t.placeId}) = 1`),
    index("work_enrichment_value_number_idx").on(t.dimensionId, t.numberValue, t.workId),
    index("work_enrichment_value_place_idx").on(t.dimensionId, t.placeId, t.workId),
    uniqueIndex("work_enrichment_value_place_unique")
      .on(t.workId, t.dimensionId, t.placeId)
      .where(sql`place_id is not null`),
  ],
);

/** The apply log and its undo (R9) */
export const enrichmentApplications = pgTable(
  "enrichment_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => enrichmentClaims.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    dimensionId: uuid("dimension_id")
      .notNull()
      .references(() => enrichmentDimensions.id, { onDelete: "restrict" }),
    target: text("target", { enum: ENRICHMENT_APPLY_TARGETS }).notNull(),
    /** The target's value, and the status of every claim the apply changed */
    before: jsonb("before").$type<Record<string, unknown>>().notNull(),
    after: jsonb("after").$type<Record<string, unknown>>().notNull(),
    appliedBy: text("applied_by", { enum: APPLIED_BY }).notNull(),
    ruleId: uuid("rule_id").references(() => enrichmentAutoAcceptRules.id, { onDelete: "restrict" }),
    batchId: uuid("batch_id"),
    /** For example the review file entry that decided it */
    note: text("note"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "enrichment_application_value_check",
      sql`${t.target} in (${sql.raw(sqlList(ENRICHMENT_APPLY_TARGETS))}) and ${t.appliedBy} in (${sql.raw(sqlList(APPLIED_BY))}) and (${t.appliedBy} = 'rule') = (${t.ruleId} is not null) and jsonb_typeof(${t.before}) = 'object' and jsonb_typeof(${t.after}) = 'object' and (${t.undoneAt} is null or ${t.undoneAt} >= ${t.appliedAt}) and (${t.note} is null or length(${t.note}) <= 2000)`,
    ),
    index("enrichment_application_applied_idx").on(t.appliedAt),
    index("enrichment_application_claim_idx").on(t.claimId),
    index("enrichment_application_work_idx").on(t.workId, t.appliedAt),
    index("enrichment_application_batch_idx").on(t.batchId),
    index("enrichment_application_edition_idx").on(t.editionId),
  ],
);

/** One measurement of one book's popularity in one month */
export const workPopularitySnapshots = pgTable(
  "work_popularity_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    /** The first day of a month */
    month: date("month", { mode: "string" }).notNull(),
    value: numeric("value", { mode: "number" }).notNull(),
    /** The API answer, or the research record; a plain key made deferrable by 0077 */
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("work_popularity_snapshot_unique").on(t.workId, t.metric, t.month),
    check(
      "work_popularity_snapshot_value_check",
      sql`${t.metric} ~ '^[a-z][a-z0-9_]*$' and length(${t.metric}) <= 100 and ${t.month} = date_trunc('month', ${t.month})::date and ${t.value} >= 0`,
    ),
    index("work_popularity_snapshot_metric_idx").on(t.metric, t.month),
    index("work_popularity_snapshot_source_idx").on(t.sourceRecordId),
  ],
);

export const enrichmentDimensionsRelations = relations(enrichmentDimensions, ({ one, many }) => ({
  family: one(taxonomyFamilies, {
    fields: [enrichmentDimensions.taxonomyFamilyId],
    references: [taxonomyFamilies.id],
  }),
  terms: many(enrichmentTerms),
}));

export const enrichmentTermsRelations = relations(enrichmentTerms, ({ one }) => ({
  dimension: one(enrichmentDimensions, {
    fields: [enrichmentTerms.dimensionId],
    references: [enrichmentDimensions.id],
  }),
  customItem: one(customTaxonomyItems, {
    fields: [enrichmentTerms.customItemId],
    references: [customTaxonomyItems.id],
  }),
}));

export const enrichmentClaimsRelations = relations(enrichmentClaims, ({ one, many }) => ({
  work: one(works, { fields: [enrichmentClaims.workId], references: [works.id] }),
  dimension: one(enrichmentDimensions, {
    fields: [enrichmentClaims.dimensionId],
    references: [enrichmentDimensions.id],
  }),
  term: one(enrichmentTerms, { fields: [enrichmentClaims.termId], references: [enrichmentTerms.id] }),
  evidence: many(claimEvidence),
}));

export const claimEvidenceRelations = relations(claimEvidence, ({ one }) => ({
  claim: one(enrichmentClaims, { fields: [claimEvidence.claimId], references: [enrichmentClaims.id] }),
  sourceRecord: one(sourceRecords, {
    fields: [claimEvidence.sourceRecordId],
    references: [sourceRecords.id],
  }),
}));
