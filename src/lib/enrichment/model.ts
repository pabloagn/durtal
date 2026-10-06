/*
 * The closed lists of the book enrichment model (SLN-462). The database
 * checks the same lists (src/lib/db/schema/enrichment.ts and the custom SQL of
 * migration 0077), so a value outside them never reaches a table.
 */

/** Where a dimension sits in the epic's layers; there is no personal layer (SLN-442) */
export const ENRICHMENT_LAYERS = ["identity", "facts", "length", "experience", "popularity"] as const;
export type EnrichmentLayer = (typeof ENRICHMENT_LAYERS)[number];

/**
 * What one claim holds: an approved term (one or several), a scale anchor, a
 * number, a short text, an external id, Durtal places or Durtal people
 */
export const ENRICHMENT_VALUE_KINDS = [
  "term",
  "terms",
  "scale",
  "number",
  "text",
  "identifier",
  "place",
  "person",
] as const;
export type EnrichmentValueKind = (typeof ENRICHMENT_VALUE_KINDS)[number];

/** Kinds that keep one accepted value per work and dimension */
export const SINGLE_VALUE_KINDS: readonly EnrichmentValueKind[] = ["term", "scale", "number", "text", "identifier"];

export const ENRICHMENT_ENTITY_LEVELS = ["work", "edition"] as const;
export type EnrichmentEntityLevel = (typeof ENRICHMENT_ENTITY_LEVELS)[number];

/** Where an accepted value is written */
export const ENRICHMENT_APPLY_TARGETS = [
  "taxonomy",
  "values",
  "work.work_type_id",
  "work.original_title",
  "work.original_language",
  "work.original_year",
  "identifier",
  "none",
  "edition.open_library_key",
  "edition.lccn",
  "edition.oclc",
  "edition.translator",
] as const;
export type EnrichmentApplyTarget = (typeof ENRICHMENT_APPLY_TARGETS)[number];

/** The value kinds each target accepts, and the level of the record it writes */
export const APPLY_TARGET_RULES: Record<
  EnrichmentApplyTarget,
  { kinds: readonly EnrichmentValueKind[]; levels: readonly EnrichmentEntityLevel[] }
> = {
  taxonomy: { kinds: ["term", "terms", "scale"], levels: ["work"] },
  values: { kinds: ["number", "place"], levels: ["work"] },
  "work.work_type_id": { kinds: ["term"], levels: ["work"] },
  "work.original_title": { kinds: ["text"], levels: ["work"] },
  "work.original_language": { kinds: ["text"], levels: ["work"] },
  "work.original_year": { kinds: ["number"], levels: ["work"] },
  identifier: { kinds: ["identifier"], levels: ["work", "edition"] },
  // Length and popularity are measurements: nothing is applied
  none: { kinds: ["number"], levels: ["work", "edition"] },
  "edition.open_library_key": { kinds: ["identifier"], levels: ["edition"] },
  "edition.lccn": { kinds: ["identifier"], levels: ["edition"] },
  "edition.oclc": { kinds: ["identifier"], levels: ["edition"] },
  "edition.translator": { kinds: ["person"], levels: ["edition"] },
};

export const UNKNOWN_HANDLING = ["exclude", "include_as_unknown"] as const;

export const CLAIM_METHODS = ["api", "agent", "human"] as const;
export type ClaimMethod = (typeof CLAIM_METHODS)[number];
export const CLAIM_STATUSES = ["proposed", "accepted", "rejected", "superseded"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_DECIDERS = ["pablo", "rule", "check"] as const;

/** Pablo's reasons to reject a proposal */
export const REJECTION_REASONS = ["wrong_value", "weak_evidence", "wrong_book", "not_independent", "other"] as const;
/** A check's codes: a claim withdrawn without a verdict on its value */
export const WITHDRAWAL_REASONS = [
  "evidence_deleted",
  "run_undone",
  "mapping_changed",
  "vocabulary_changed",
  "undone",
] as const;
export const DECISION_REASONS = [...REJECTION_REASONS, ...WITHDRAWAL_REASONS] as const;
export type DecisionReason = (typeof DECISION_REASONS)[number];

export const EVIDENCE_LOCATORS = ["text", "payload"] as const;
/** The longest excerpt a claim may cite (R10) */
export const MAX_EXCERPT_LENGTH = 1000;

export const APPLIED_BY = ["pablo", "rule"] as const;
export const RULE_BASES = ["exact_identifier_match", "evaluation_gate"] as const;
/** The precision a gated rule needs before it may be turned on (R8) */
export const GATE_PRECISION = 0.95;

export const JOB_KINDS = ["identity", "facts", "length", "popularity", "research", "extract"] as const;
export type EnrichmentJobKind = (typeof JOB_KINDS)[number];
export const JOB_STATUSES = ["queued", "running", "done", "failed", "held"] as const;
/** Open jobs: at most one per work and kind */
export const OPEN_JOB_STATUSES = ["queued", "running", "held"] as const;
export const JOB_HELD_REASONS = ["quota", "rate_limited", "budget", "work_cost_ceiling"] as const;

/** A quoted SQL list of these values, for the database's checks */
export function sqlList(values: readonly string[]) {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
}
