import { z } from "zod";
import { stableStringify } from "@/lib/harmonization/normalize";

/** Enrichment-only scope, not a replacement for Work → Edition → Instance. */
export const ASSERTION_CONTRACT_VERSION = 1;
export const ASSERTION_RELATIONS = [
  "classification",
  "about",
  "thematizes",
  "mentions",
  "primary_setting",
  "secondary_setting",
  "frame_setting",
  "remembered_setting",
  "embedded_setting",
] as const;
export const KNOWLEDGE_STATES = ["present", "established_absent", "unassessed", "partially_assessed", "disputed", "not_applicable"] as const;

const identityKey = z.string().trim().min(1).max(500).nullable();
export const assertionScopeSchema = z
  .strictObject({
    version: z.literal(ASSERTION_CONTRACT_VERSION),
    kind: z.enum(["work", "text", "component", "edition"]),
    /** A reviewed baseline/text identity URI or content fingerprint, never an inferred ISBN match. */
    identityKey: identityKey.default(null),
    languages: z
      .array(z.string().regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/))
      .max(10)
      .default([])
      .transform((v) => [...new Set(v)].sort()),
    textKind: z.enum(["original", "translation", "revision", "abridgment", "parallel", "unknown"]).default("unknown"),
    componentKey: identityKey.default(null),
    componentKind: z.enum(["independent_work", "integral_part", "augmenting_work", "parallel_text"]).nullable().default(null),
    /** Unknown identity is tied to one source observation, not guessed across documents. */
    unresolvedSourceId: z.uuid().nullable().default(null),
    relation: z.enum(ASSERTION_RELATIONS).default("classification"),
  })
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (s.kind !== "component" && (s.componentKey || s.componentKind)) fail("Only a component scope carries component identity");
    if (s.kind === "component" && !s.componentKind) fail("A component must declare its structural role");
    if (s.kind === "edition" && (s.identityKey || s.unresolvedSourceId || s.componentKey)) fail("An edition is identified by its existing editionId");
    if (
      s.kind !== "edition" &&
      !s.unresolvedSourceId &&
      (!s.identityKey || (s.kind !== "work" && !s.languages.length) || (s.kind === "component" && !s.componentKey))
    )
      fail("An unidentified baseline, text or component must retain its source observation");
    if (s.kind === "work" && s.textKind !== "original" && s.textKind !== "unknown") fail("A translation or revision is not the Work baseline");
  });
export type AssertionScope = z.infer<typeof assertionScopeSchema>;
export type AssertionScopeInput = z.input<typeof assertionScopeSchema>;

export const assertionAssessmentSchema = z
  .strictObject({
    knowledge: z.enum(KNOWLEDGE_STATES),
    coverage: z.enum(["unassessed", "partial", "complete"]),
    basis: z.enum(["local_evidence", "critical_account", "complete_reading"]),
    justification: z.string().trim().min(1).max(2000),
  })
  .superRefine((a, ctx) => {
      if (a.knowledge !== "unassessed" && a.coverage === "unassessed")
        ctx.addIssue({ code: "custom", message: "A knowledge assertion requires assessed evidence coverage" });
    if (a.knowledge === "established_absent" && (a.coverage !== "complete" || a.basis !== "complete_reading"))
      ctx.addIssue({ code: "custom", message: "Absence requires a documented complete examination of this exact scope" });
  });
export type AssertionAssessment = z.infer<typeof assertionAssessmentSchema>;

export function scopeKey(scope: AssertionScope | null, editionId: string | null = null): string {
  return stableStringify({ scope: scope ? assertionScopeSchema.parse(scope) : null, editionId });
}

/** Equality includes the relation, language, text and component. It grants no inheritance. */
export function sameAssertionScope(
  a: AssertionScope | null,
  b: AssertionScope | null,
  aEdition: string | null = null,
  bEdition: string | null = null,
): boolean {
  return scopeKey(a, aEdition) === scopeKey(b, bEdition);
}

export function unresolvedTextScope(sourceRecordId: string): AssertionScope {
  return assertionScopeSchema.parse({ version: 1, kind: "text", unresolvedSourceId: sourceRecordId });
}

/** Missing/rejected/disputed/partial is unknown, never a negative training label. */
export function assertionTruth(assessment: AssertionAssessment | null, decision: string): boolean | null {
  if (decision !== "accepted" || !assessment) return null;
  if (assessment.knowledge === "present") return true;
  if (assessment.knowledge === "established_absent" || assessment.knowledge === "not_applicable") return false;
  return null;
}

/** Scope/role changes are not inherited automatically, including faithful translations. */
export function canUseAssertionAt(source: AssertionScope, target: AssertionScope, sourceEditionId: string | null = null, targetEditionId: string | null = null): boolean {
  if ((source.kind === "edition" || target.kind === "edition") && (!sourceEditionId || !targetEditionId)) return false;
  return !source.unresolvedSourceId && !target.unresolvedSourceId && sameAssertionScope(source, target, sourceEditionId, targetEditionId);
}
