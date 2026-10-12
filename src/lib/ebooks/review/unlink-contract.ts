import { sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/catalogue/work-store";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { reviewOperationSchema, type ReviewOperation } from "@/lib/validations/ebook-review";
import { immutableMatchingWriterInput, type LinkReceipt } from "../match/link";
import type { UndoLinkPlan } from "../match/undo";
import type { PreparedMatchAtomicExtension } from "../match/review-extension";
import { canonicalReviewJson, ebookReviewSnapshotSchema, reviewPayloadHash } from "./receipts";
import { ebookRawSnapshotSql, ebookSnapshotSql, ebookSnapshotTimesAreValidSql,
  reviewTimestampIsValidSql, reviewTimestampSql } from "./store-sql";
import { ReviewError, REVIEW_SQL_ERRORS } from "./errors";

/** Proposed authoritative CORE interface, source-only until495 implements and
 * reviews it. This module never calls an unlink writer or issues an extension.
 * Default undo_link plans below are inspection evidence only: they cannot be
 * used as a reviewed decision by the current compensation-only issuer. */
export const prepareReviewUnlinkIntentSchema = z.strictObject({
  ebookId: z.uuid().transform((id) => id.toLowerCase()),
  mode: z.enum(["automatic_undo", "unlink"]),
  /** Actual matching identity displayed by the read projection; if supplied,
   * reject a replaced link during preparation rather than quietly changing it. */
  originalMatchingOperation: reviewOperationSchema.optional(),
});
const policySchema = z.strictObject({
  version: z.literal(1), purpose: z.literal("unlink_decision"),
  mode: z.enum(["automatic_undo", "unlink"]), ebookId: z.uuid(),
  originalMatchingOperation: reviewOperationSchema,
  expectedCurrent: ebookReviewSnapshotSchema,
  rawEbookSnapshotText: z.string().min(1),
  /** Exact DB text of the native after row with its timestamps normalized on
   * the supplied connection; never compare differently formatted version text. */
  matchingAfterEbookText: z.string().min(1),
});
export type ReviewUnlinkPolicy = z.output<typeof policySchema>;
export type ReviewUnlinkPlan = UndoLinkPlan & { reviewUnlink: ReviewUnlinkPolicy };
export type ReviewUnlinkPlanning = { kind: "unchanged"; reason: "missing_or_later_operation" } |
  { kind: "planned"; plan: ReviewUnlinkPlan };
/**495's actual exports must satisfy this contract after source review. Do not
 * inject an unchecked writer, cast a default plan or fabricate compensation. */
export interface ReviewedUnlinkCore {
  planOn(conn: Db, receipt: LinkReceipt, target: string, now: string | undefined,
    options: { reviewUnlink: ReviewUnlinkPolicy }): Promise<ReviewUnlinkPlanning>;
  write(conn: Db, plan: ReviewUnlinkPlan, target: string,
    options: { atomicExtension: PreparedMatchAtomicExtension }): Promise<readonly unknown[]>;
}
const same = (a: unknown, b: unknown) => canonicalReviewJson(a) === canonicalReviewJson(b);
export function matchingOperationOf(receipt: LinkReceipt): ReviewOperation {
  return reviewOperationSchema.parse({ version: receipt.version, operationId: receipt.operationId,
    runId: receipt.runId, planSha256: receipt.planSha256, targetDatabase: receipt.targetDatabase });
}
/** Parse a policy and prove its fields describe one actual stored raw row,
 * including the original matching receipt identity. No original review audit
 * is invented or required by a fresh unlink decision. */
export function parseReviewUnlinkPolicy(input: unknown): ReviewUnlinkPolicy {
  const policy = policySchema.parse(immutableMatchingWriterInput(input));
  try {
    const raw = JSON.parse(policy.rawEbookSnapshotText) as Record<string, unknown>;
    const receipt = raw.link_written as LinkReceipt | null;
    if (!receipt || !receipt.after || !["link", "accession"].includes(receipt.kind) ||
        raw.id !== policy.ebookId || receipt.ebookId !== policy.ebookId || raw.match_state !== "linked" ||
        receipt.instanceId !== raw.instance_id || raw.instance_id !== policy.expectedCurrent.instanceId ||
        !same(matchingOperationOf(receipt), policy.originalMatchingOperation) ||
        policy.expectedCurrent.matchState !== "linked" || policy.expectedCurrent.candidatesHash !== reviewPayloadHash([]) ||
        raw.updated_at !== policy.expectedCurrent.updatedAt ||
        (raw.match_fingerprint ?? null) !== policy.expectedCurrent.matchFingerprint ||
        (raw.match_tier ?? null) !== policy.expectedCurrent.matchTier ||
        (raw.exclusion_reason ?? null) !== policy.expectedCurrent.exclusionReason)
      throw new Error("Policy and current matching receipt differ");
    if (policy.mode === "automatic_undo" && (!['isbn', 'identifier', 'score'].includes(String(raw.match_method)) ||
        !same(Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "link_written")), JSON.parse(policy.matchingAfterEbookText))))
      throw new ReviewError("stale_review", "The automatic link has a later eBook change.");
    return immutableMatchingWriterInput(policy);
  } catch (cause) {
    if (cause instanceof ReviewError) throw cause;
    throw new ReviewError("invalid_receipt", "The stored matching receipt cannot authorize unlink.", { cause });
  }
}
function matchingAfterTimesValidSql(): SQL {
  const row = sql`e.link_written #> '{after,ebook}'`;
  return sql`(jsonb_typeof(${row})='object'
    and ${reviewTimestampIsValidSql(sql`(${row}->>'created_at')::timestamptz`)}
    and ${reviewTimestampIsValidSql(sql`(${row}->>'updated_at')::timestamptz`)}
    and (${row}->>'matched_at' is null or ${reviewTimestampIsValidSql(sql`(${row}->>'matched_at')::timestamptz`)})) IS TRUE`;
}
function matchingAfterEbookSql(): SQL {
  const row = sql`e.link_written #> '{after,ebook}'`;
  return sql`(${row} || jsonb_build_object(
    'created_at',${reviewTimestampSql(sql`(${row}->>'created_at')::timestamptz`)},
    'updated_at',${reviewTimestampSql(sql`(${row}->>'updated_at')::timestamptz`)},
    'matched_at',(${row}->>'matched_at')::timestamptz))::text`;
}
export async function readMatchingUnlinkAfterOn(conn: Db, ebookId: string): Promise<string> {
  const id = z.uuid().parse(ebookId).toLowerCase();
  const evidence = resultRows<{ text: string; valid: boolean }>(await conn.execute(sql`
    select ${matchingAfterEbookSql()} as text,${matchingAfterTimesValidSql()} as valid
    from ebooks e where e.id=${id}::uuid`));
  if (evidence.length !== 1 || !evidence[0].valid || !evidence[0].text)
    throw new ReviewError("invalid_receipt", "The committed matching after-state cannot be verified.");
  return evidence[0].text;
}
/**495 must call these inside its existing single locked atomic before all
 * changes. Its complete snapshot/dependency/FK guards still apply. */
export function reviewUnlinkGuardQueries(d: Db, input: ReviewUnlinkPolicy): readonly unknown[] {
  const policy = parseReviewUnlinkPolicy(input);
  return [d.execute(assertSql(sql`exists(select 1 from ebooks e where e.id=${policy.ebookId}::uuid
    and ${ebookSnapshotTimesAreValidSql()} and ${ebookRawSnapshotSql()}=${policy.rawEbookSnapshotText}
    and ${matchingAfterTimesValidSql()} and ${matchingAfterEbookSql()}=${policy.matchingAfterEbookText}
    and ${ebookSnapshotSql()}=${JSON.stringify(policy.expectedCurrent)}::jsonb)`, REVIEW_SQL_ERRORS.stale))];
}
/** This branch is mutually exclusive with reviewCompensation.495 must use it
 * for the clear-link UPDATE and touchEbook:false in subsequent classification,
 * preserving strict actual forward time in the final496 receipt assertions. */
export function reviewUnlinkForwardUpdatedAt(input: ReviewUnlinkPolicy): SQL {
  parseReviewUnlinkPolicy(input);
  return sql`greatest(clock_timestamp(),updated_at+interval '1 microsecond')`;
}
