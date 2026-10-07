import { z } from "zod";
import {
  APPLY_TARGET_RULES,
  CLAIM_METHODS,
  ENRICHMENT_APPLY_TARGETS,
  ENRICHMENT_ENTITY_LEVELS,
  ENRICHMENT_LAYERS,
  ENRICHMENT_VALUE_KINDS,
  JOB_HELD_REASONS,
  JOB_KINDS,
  MAX_EXCERPT_LENGTH,
  REJECTION_REASONS,
  RULE_BASES,
  UNKNOWN_HANDLING,
} from "@/lib/enrichment/model";

/*
 * Book enrichment inputs (SLN-462): jobs, proposals, the inbox actions and
 * the vocabulary seed file. Every action and service parses its input here.
 */

const slug = z.string().regex(/^[a-z0-9]+([_-][a-z0-9]+)*$/).max(100);
const https = z.url({ protocol: /^https$/ }).max(2000);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const text = (max: number) => z.string().trim().min(1).max(max);

/** Why a job was queued */
export const JOB_REASONS = ["created", "monthly", "vocabulary", "mapping", "research", "manual"] as const;
export const jobReasonSchema = z.enum(JOB_REASONS);
export const heldReasonSchema = z.enum(JOB_HELD_REASONS);
export const jobKindSchema = z.enum(JOB_KINDS);

export const enqueueJobSchema = z.object({
  workId: z.uuid(),
  kind: jobKindSchema,
  reason: jobReasonSchema,
  /** Dimension keys the job looks at; none means every dimension of its stage */
  dimensions: z.array(slug).max(100).default([]),
  vocabularyVersion: z.number().int().min(1).optional(),
  priority: z.number().int().min(0).max(32767).default(100),
  runAfter: z.date().optional(),
});
export type EnqueueJobInput = z.input<typeof enqueueJobSchema>;

export const claimJobSchema = z.object({
  worker: text(200),
  kinds: z.array(jobKindSchema).min(1),
  jobIds: z.array(z.uuid()).min(1).optional(),
  workIds: z.array(z.uuid()).min(1).optional(),
});

/** One excerpt supporting a proposal */
export const evidenceInputSchema = z.discriminatedUnion("locator", [
  z.object({
    locator: z.literal("payload"),
    sourceRecordId: z.uuid(),
    extractorVersion: text(200),
    excerpt: z.string().min(1).max(MAX_EXCERPT_LENGTH),
    payloadPath: z.array(z.string().min(1).max(200)).min(1).max(20),
  }),
  z.object({
    locator: z.literal("text"),
    sourceRecordId: z.uuid(),
    extractorVersion: text(200),
    excerpt: z.string().min(1).max(MAX_EXCERPT_LENGTH),
    startOffset: z.number().int().min(0),
    endOffset: z.number().int().min(1),
    textSha256: sha256,
  }),
]);
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;

/** One proposed value: a term (by key), a number, a text, a place or a person */
export const claimValueSchema = z.union([
  z.object({ term: slug }),
  z.object({ number: z.number().finite() }),
  z.object({ text: text(500) }),
  z.object({ placeId: z.uuid() }),
  z.object({ personId: z.uuid() }),
]);
export type ClaimValueInput = z.infer<typeof claimValueSchema>;

export const proposalSchema = z.object({
  workId: z.uuid(),
  editionId: z.uuid().optional(),
  dimension: slug,
  value: claimValueSchema,
  method: z.enum(CLAIM_METHODS),
  confidence: z.number().min(0).max(1),
  vocabularyVersion: z.number().int().min(1),
  runId: z.uuid().optional(),
  jobId: z.uuid().optional(),
  note: text(2000).optional(),
  evidence: z.array(evidenceInputSchema).max(50).default([]),
  /** A check with valid evidence may store the proposal already rejected */
  rejectAs: z.literal("not_independent").optional(),
});
export type ProposalInput = z.input<typeof proposalSchema>;

const fingerprint = z.string().regex(/^[a-f0-9]{32}$/);
export const acceptClaimsSchema = z
  .array(z.object({ claimId: z.uuid(), fingerprint }))
  .min(1)
  .max(20);
export const rejectClaimsSchema = z
  .array(
    z.object({
      claimId: z.uuid(),
      fingerprint,
      reason: z.enum(REJECTION_REASONS),
      note: text(2000).optional(),
    }),
  )
  .min(1)
  .max(20);
export const humanClaimSchema = z.object({
  workId: z.uuid(),
  editionId: z.uuid().optional(),
  dimension: slug,
  value: claimValueSchema,
  note: text(2000).optional(),
});
export type HumanClaimInput = z.input<typeof humanClaimSchema>;

// ── The vocabulary seed file (one per approved version) ─────────────────────

const exampleSchema = z.union([
  z.object({ workId: z.uuid(), slug: z.string().optional() }).strict(),
  z.object({ title: text(500), author: text(500) }).strict(),
]);

const termSeedSchema = z
  .object({
    key: slug,
    label: text(200),
    definition: text(4000),
    appliesWhen: text(4000),
    doesNotApplyWhen: text(4000),
    examples: z.array(exampleSchema).min(1),
    /** Scale anchors only */
    scaleValue: z.number().finite().optional(),
    /** The parent term's key, for a hierarchical family */
    parent: slug.optional(),
    /** The item it governs: an existing item of the family by slug, or a new one */
    item: z.object({ slug, name: text(200).optional() }).strict().optional(),
    /** For a form dimension: the work type it governs, by name */
    workType: text(200).optional(),
  })
  .strict();

/** Popularity bands: percentiles from and to, the lower included */
const bandSchema = z
  .object({ key: slug, label: text(100), fromPercentile: z.number().min(0).max(100), toPercentile: z.number().min(0).max(100) })
  .strict()
  .refine((b) => b.fromPercentile < b.toPercentile, "A band starts below its end");

/** The parameters section 2 defines; each dimension uses only its own */
const parametersSchema = z
  .object({
    /** A facts dimension SLN-469 may also research in reviews */
    research: z.boolean().optional(),
    /** Term keys that exclude each other */
    exclusiveTerms: z.array(z.array(slug).min(2)).optional(),
    /** For a scale: which end is the easier one */
    easierEnd: z.enum(["low", "high"]).optional(),
    /** For a popularity dimension: its bands */
    bands: z.array(bandSchema).min(1).optional(),
  })
  .strict();

const ruleSeedSchema = z
  .object({
    basis: z.enum(RULE_BASES),
    minimumConfidence: z.number().min(0).max(1),
    minimumSample: z.number().int().min(1).optional(),
  })
  .strict();

const dimensionSeedSchema = z
  .object({
    key: slug,
    label: text(200),
    definition: text(4000),
    layer: z.enum(ENRICHMENT_LAYERS),
    valueKind: z.enum(ENRICHMENT_VALUE_KINDS),
    entityLevel: z.enum(ENRICHMENT_ENTITY_LEVELS).default("work"),
    provider: z.string().regex(/^[a-z0-9]+([._-][a-z0-9]+)*$/).max(100).optional(),
    applyTarget: z.enum(ENRICHMENT_APPLY_TARGETS),
    /** The taxonomy family by slug: a system family or a custom one */
    family: slug.optional(),
    /** A custom family the version creates */
    newFamily: z.object({ name: text(100), hierarchical: z.boolean().default(false) }).strict().optional(),
    attributeCategory: text(100).optional(),
    requiresIndependentSources: z.boolean().default(false),
    autoAcceptEligible: z.boolean().default(false),
    unknownHandling: z.enum(UNKNOWN_HANDLING).default("exclude"),
    parameters: parametersSchema.default({}),
    terms: z.array(termSeedSchema).default([]),
    /** One disabled rule; only on an eligible dimension */
    rule: ruleSeedSchema.optional(),
  })
  .strict();
export type DimensionSeed = z.infer<typeof dimensionSeedSchema>;

/** The rules every seed obeys beyond its shape; each problem names its place */
export function seedProblems(seed: { dimensions: DimensionSeed[] }): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const d of seed.dimensions) {
    const at = `dimensions.${d.key}`;
    if (keys.has(d.key)) problems.push(`${at}: the key is used twice`);
    keys.add(d.key);
    const rule = APPLY_TARGET_RULES[d.applyTarget];
    if (!rule.kinds.includes(d.valueKind)) problems.push(`${at}: a ${d.valueKind} value does not fit ${d.applyTarget}`);
    if (!rule.levels.includes(d.entityLevel)) problems.push(`${at}: ${d.applyTarget} writes a ${rule.levels.join(" or ")}`);
    if ((d.valueKind === "identifier") !== !!d.provider) problems.push(`${at}: an identifier dimension names its provider, and only one does`);
    if ((d.applyTarget === "taxonomy") !== !!d.family) problems.push(`${at}: a taxonomy dimension names its family, and only one does`);
    if (d.attributeCategory && d.family !== "attributes") problems.push(`${at}: only an attributes dimension names a category`);
    if (d.rule && !d.autoAcceptEligible) problems.push(`${at}: a rule needs an eligible dimension`);
    if (d.rule?.basis === "exact_identifier_match" && d.layer !== "identity") problems.push(`${at}: an exact identifier match rule is for identity only`);
    if (d.rule?.basis === "evaluation_gate" && !d.rule.minimumSample) problems.push(`${at}: a gated rule names its minimum sample`);
    const termKinds = ["term", "terms", "scale"].includes(d.valueKind);
    if (!termKinds && d.terms.length) problems.push(`${at}: only a term, terms or scale dimension has terms`);
    if (termKinds && !d.terms.length) problems.push(`${at}: a ${d.valueKind} dimension needs terms`);
    const p = d.parameters;
    if (p.research !== undefined && d.layer !== "facts") problems.push(`${at}.parameters.research: only for a facts dimension`);
    if (p.easierEnd !== undefined && d.valueKind !== "scale") problems.push(`${at}.parameters.easierEnd: only for a scale`);
    if (p.bands !== undefined && d.layer !== "popularity") problems.push(`${at}.parameters.bands: only for a popularity dimension`);
    if (p.exclusiveTerms !== undefined && !["term", "terms"].includes(d.valueKind)) problems.push(`${at}.parameters.exclusiveTerms: only for a term or terms dimension`);
    const termKeys = new Set<string>();
    for (const t of d.terms) {
      const tat = `${at}.terms.${t.key}`;
      if (termKeys.has(t.key)) problems.push(`${tat}: the key is used twice`);
      termKeys.add(t.key);
      if (d.valueKind === "scale") {
        if (t.scaleValue === undefined) problems.push(`${tat}: a scale point has its value`);
      } else {
        if (t.scaleValue !== undefined) problems.push(`${tat}: only a scale point has a value`);
        if (t.examples.length < 3) problems.push(`${tat}: a term needs at least three examples`);
      }
      if ((d.applyTarget === "work.work_type_id") !== !!t.workType) problems.push(`${tat}: a form term names its work type, and only one does`);
      if (d.applyTarget === "work.work_type_id" && t.item) problems.push(`${tat}: a form term governs a work type, not an item`);
    }
    for (const t of d.terms)
      if (t.parent && (!termKeys.has(t.parent) || t.parent === t.key)) problems.push(`${at}.terms.${t.key}: its parent is not a term of this dimension`);
    for (const group of p.exclusiveTerms ?? [])
      for (const key of group) if (!termKeys.has(key)) problems.push(`${at}.parameters.exclusiveTerms: ${key} is not a term of this dimension`);
  }
  return problems;
}

export const vocabularySeedSchema = z
  .object({
    version: z.number().int().min(1).max(32767),
    documentUrl: https,
    notes: text(4000).optional(),
    dimensions: z.array(dimensionSeedSchema).min(1),
  })
  .strict()
  .superRefine((seed, ctx) => {
    for (const message of seedProblems(seed)) ctx.addIssue({ code: "custom", message });
  });
export type VocabularySeed = z.infer<typeof vocabularySeedSchema>;

export { sha256 as sha256Schema };
