import type { ClaimStatus, DecisionReason, EnrichmentValueKind } from "./model";
import type { ClaimValueInput } from "@/lib/validations/enrichment";

/*
 * Pure rules of the enrichment services (SLN-462): a value's columns, the
 * proposal skip rules, the daily cap on rule applies and the job backoff.
 */

/**
 * Rule applies allowed in a rolling 24 hours (R9), as SLN-461's v1 proposal
 * sets them: exact identity links (`exact_identifier_match` rules) on their
 * own cap, every other rule apply on a shared one.
 */
export const DAILY_RULE_APPLY_CAP = 20;
export const DAILY_EXACT_IDENTITY_APPLY_CAP = 100;
/** The cap a rule's applies count against */
export const ruleCap = (basis: "exact_identifier_match" | "evaluation_gate") =>
  basis === "exact_identifier_match" ? DAILY_EXACT_IDENTITY_APPLY_CAP : DAILY_RULE_APPLY_CAP;
/** Rule applies still allowed after `recent` in the last 24 hours */
export const ruleAppliesLeft = (recent: number, cap = DAILY_RULE_APPLY_CAP) => Math.max(0, cap - recent);

/** A job fails for good after this many attempts */
export const MAX_JOB_ATTEMPTS = 5;
/** A running job whose lease is older is abandoned, and may be claimed again */
export const JOB_LEASE_MINUTES = 30;
/** Minutes before a failed job's next attempt: 2, 4, 8, 16 */
export const retryDelayMinutes = (attempts: number) => 2 ** attempts;

/** A job's last error, short and without anything a URL could carry */
export function jobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/g, (url) => url.replace(/[?#].*$/, "?…"))
    .replace(/\b(authorization|api[_-]?key|token|secret)\b\s*[:=]\s*\S+/gi, "$1: …")
    .slice(0, 500);
}

/** The value columns of a claim, from a proposal's value and its dimension's kind */
export interface ClaimColumns {
  termId: string | null;
  numberValue: number | null;
  textValue: string | null;
  placeId: string | null;
  personId: string | null;
}
export function claimColumns(
  kind: EnrichmentValueKind,
  value: ClaimValueInput,
  term?: { id: string; scaleValue: number | null } | null,
): ClaimColumns {
  const empty: ClaimColumns = { termId: null, numberValue: null, textValue: null, placeId: null, personId: null };
  const wrong = () => {
    throw new Error(`A ${kind} dimension takes a value of its own kind`);
  };
  switch (kind) {
    case "term":
    case "terms":
      if (!("term" in value) || !term) return wrong();
      return { ...empty, termId: term.id };
    case "scale":
      if (!("term" in value) || !term || term.scaleValue === null) return wrong();
      return { ...empty, termId: term.id, numberValue: term.scaleValue };
    case "number":
      return "number" in value ? { ...empty, numberValue: value.number } : wrong();
    case "text":
    case "identifier":
      return "text" in value ? { ...empty, textValue: value.text } : wrong();
    case "place":
      return "placeId" in value ? { ...empty, placeId: value.placeId } : wrong();
    case "person":
      return "personId" in value ? { ...empty, personId: value.personId } : wrong();
  }
}

/** A claim of the proposed value already on the book */
export interface SameValueClaim {
  id: string;
  status: ClaimStatus;
  decisionReason: DecisionReason | null;
  /** The source records its evidence cites */
  sourceIds: string[];
}

/** Rejections for good: the value is wrong, or it is another book */
const FINAL = new Set<DecisionReason>(["wrong_value", "wrong_book"]);
/** Rejections of the evidence: only a new source opens the value again */
const ON_SOURCES = new Set<DecisionReason>(["weak_evidence", "not_independent", "other"]);

export type ProposalOutcome =
  | { kind: "create" }
  | { kind: "merge"; claimId: string }
  | { kind: "skip"; reason: string };

/**
 * What proposing a value does, given the claims of that value on the book.
 * A withdrawal (run undone, mapping or vocabulary changed, evidence deleted,
 * undone) never blocks a new proposal of the same value.
 */
export function proposalOutcome(input: {
  claims: SameValueClaim[];
  /** The term's item is linked to the book already, whatever wrote the link */
  linked: boolean;
  sourceIds: string[];
}): ProposalOutcome {
  if (input.claims.some((c) => c.status === "accepted")) return { kind: "skip", reason: "already accepted" };
  if (input.linked) return { kind: "skip", reason: "already linked" };
  if (input.claims.some((c) => c.status === "rejected" && c.decisionReason && FINAL.has(c.decisionReason)))
    return { kind: "skip", reason: "rejected for good" };
  const covered = (c: SameValueClaim) => input.sourceIds.every((id) => c.sourceIds.includes(id));
  if (input.claims.some((c) => c.status === "rejected" && c.decisionReason && ON_SOURCES.has(c.decisionReason) && covered(c)))
    return { kind: "skip", reason: "rejected on the same sources" };
  const open = input.claims.find((c) => c.status === "proposed");
  return open ? { kind: "merge", claimId: open.id } : { kind: "create" };
}
