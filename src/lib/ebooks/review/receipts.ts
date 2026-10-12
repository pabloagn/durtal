import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  exclusionReasonSchema,
  reviewDecisionRequestSchema,
  reviewHashSchema,
  reviewOperationSchema,
  reviewTimestampSchema,
  workReviewStampSchema,
  type ReviewDecisionRequest,
  type ReviewOperation,
} from "@/lib/validations/ebook-review";

export const REVIEW_RECEIPT_EVENTS = {
  ebookDecision: "ebook.review.decision.v1",
  ebookUndo: "ebook.review.undo.v1",
  workDecision: "ebook.review.catalogue_status.v1",
  workUndo: "ebook.review.catalogue_status_undo.v1",
} as const;

/** JSON canonicalization for hashes, with no lossy undefined/NaN/date serialization. */
export function canonicalReviewJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (
      Object.keys(value).length !== value.length ||
      Object.getOwnPropertySymbols(value).length ||
      Array.from({ length: value.length }, (_, index) =>
        Object.hasOwn(value, index),
      ).some((present) => !present)
    )
      throw new Error("Sparse or augmented arrays are not canonical JSON");
    return `[${value.map(canonicalReviewJson).join(",")}]`;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    if (Object.getOwnPropertySymbols(value).length)
      throw new Error("Symbol keys are not canonical JSON");
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalReviewJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  throw new Error("Review hashes require plain finite JSON values");
}
export function reviewPayloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalReviewJson(value)).digest("hex");
}
/** Optional omitted fields stay omitted; null and array ordering remain significant. */
export function reviewRequestHash(input: unknown): string {
  const request = reviewDecisionRequestSchema.parse(input);
  return reviewPayloadHash(JSON.parse(JSON.stringify(request)));
}
/** Unique compensation key per original operation, stable across retries and workers. */
export function reviewUndoOperationId(input: ReviewOperation): string {
  const original = reviewOperationSchema.parse(input);
  const hash = reviewPayloadHash({
    namespace: "durtal.ebook.review.undo.v1",
    original,
  });
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${((parseInt(hash[16], 16) & 3) | 8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const ebookSnapshotSchema = z
  .strictObject({
    matchState: z.enum(["pending", "linked", "standalone", "excluded"]),
    matchTier: z
      .enum([
        "exact",
        "strong",
        "likely",
        "to_choose",
        "same_author",
        "conflict",
        "duplicate",
        "not_a_book",
        "not_in_durtal",
      ])
      .nullable(),
    matchFingerprint: reviewHashSchema.nullable(),
    updatedAt: reviewTimestampSchema,
    instanceId: z.uuid().nullable(),
    exclusionReason: exclusionReasonSchema.nullable(),
    candidatesHash: reviewHashSchema,
  })
  .refine(
    (snapshot) =>
      (snapshot.matchState === "linked") === (snapshot.instanceId !== null),
    "Linked state must name its copy",
  )
  .refine(
    (snapshot) =>
      (snapshot.matchState === "excluded") ===
      (snapshot.exclusionReason !== null),
    "Excluded state must name its reason",
  )
  .refine(
    (snapshot) =>
      snapshot.matchState === "pending" || snapshot.matchTier === null,
    "Decided rows cannot retain a pending tier",
  );
const baseReceipt = {
  version: z.literal(1),
  operation: reviewOperationSchema,
  requestHash: reviewHashSchema,
  effectHash: reviewHashSchema,
  outcome: z.strictObject({
    message: z.string().min(1).max(2000),
    keptCopy: z.boolean(),
  }),
};
const ebookReceiptSchema = z.strictObject({
  ...baseReceipt,
  entityType: z.literal("ebook"),
  entityId: z.uuid(),
  eventKey: z.enum([
    REVIEW_RECEIPT_EVENTS.ebookDecision,
    REVIEW_RECEIPT_EVENTS.ebookUndo,
  ]),
  action: z.enum([
    "accept",
    "link",
    "accession",
    "keep",
    "exclude",
    "rematch",
    "restore",
    "unlink",
    "undo",
  ]),
  originalOperation: reviewOperationSchema.nullable(),
  before: ebookSnapshotSchema,
  after: ebookSnapshotSchema,
});
/** Static receipt fields are checked before query construction. The after-state
 * is captured and validated by the database, never synthesized for this parser. */
export const ebookReviewReceiptSeedSchema = ebookReceiptSchema.omit({ after: true });
export const ebookReviewSnapshotSchema = ebookSnapshotSchema;
const workReceiptSchema = z.strictObject({
  ...baseReceipt,
  entityType: z.literal("work"),
  entityId: z.uuid(),
  eventKey: z.enum([
    REVIEW_RECEIPT_EVENTS.workDecision,
    REVIEW_RECEIPT_EVENTS.workUndo,
  ]),
  action: z.enum(["mark_accessioned", "undo"]),
  originalOperation: reviewOperationSchema.nullable(),
  before: workReviewStampSchema,
  after: workReviewStampSchema,
});
export const workReviewReceiptSeedSchema = workReceiptSchema.omit({ after: true });
export const reviewReceiptSchema = z
  .discriminatedUnion("entityType", [ebookReceiptSchema, workReceiptSchema])
  .superRefine((receipt, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    const undo = receipt.action === "undo";
    const event =
      receipt.entityType === "ebook"
        ? undo
          ? REVIEW_RECEIPT_EVENTS.ebookUndo
          : REVIEW_RECEIPT_EVENTS.ebookDecision
        : undo
          ? REVIEW_RECEIPT_EVENTS.workUndo
          : REVIEW_RECEIPT_EVENTS.workDecision;
    if (
      receipt.eventKey !== event ||
      undo !== (receipt.originalOperation !== null)
    )
      fail(
        "Receipt namespace and original identity must agree with its action",
      );
    if (receipt.before.updatedAt >= receipt.after.updatedAt)
      fail("A committed change requires a later exact timestamp");
    if (receipt.originalOperation) {
      const original = receipt.originalOperation;
      if (
        receipt.operation.operationId !== reviewUndoOperationId(original) ||
        receipt.operation.runId !== original.runId ||
        receipt.operation.targetDatabase !== original.targetDatabase ||
        receipt.operation.planSha256 !== original.planSha256
      )
        fail("Compensation identity does not bind its original operation");
    }
    if (receipt.entityType === "work") {
      if (
        !receipt.after.latestHistoryId ||
        receipt.after.latestHistoryId === receipt.before.latestHistoryId ||
        receipt.after.historyFingerprint === receipt.before.historyFingerprint
      )
        fail("Status changes require a new history identity");
      if (
        receipt.before.dependencyFingerprint !==
        receipt.after.dependencyFingerprint
      )
        fail("A status change cannot mutate holdings or orders");
      if (receipt.before.catalogueStatus === receipt.after.catalogueStatus)
        fail("A status receipt requires a status change");
      if (
        !undo &&
        (receipt.after.catalogueStatus !== "accessioned" ||
          !["tracked", "shortlisted", "wanted", "on_order"].includes(
            receipt.before.catalogueStatus,
          ))
      )
        fail("Accession status receipt has invalid states");
    } else if (receipt.action !== "undo") {
      const states = {
        accept: "linked",
        link: "linked",
        accession: "linked",
        keep: "standalone",
        exclude: "excluded",
        restore: "pending",
        unlink: "pending",
        rematch: "pending",
      } as const;
      if (receipt.after.matchState !== states[receipt.action])
        fail("Decision receipt has the wrong resulting state");
      const allowedBefore = {
        accept: ["pending"],
        link: ["pending", "standalone"],
        accession: ["pending", "standalone"],
        keep: ["pending"],
        exclude: ["pending", "standalone"],
        rematch: ["pending"],
        restore: ["standalone", "excluded"],
        unlink: ["linked"],
      };
      if (!allowedBefore[receipt.action].includes(receipt.before.matchState))
        fail("Decision receipt has an ineligible prior state");
    }
    if (
      receipt.entityType === "ebook" &&
      receipt.after.matchState !== "pending" &&
      receipt.after.candidatesHash !== reviewPayloadHash([])
    )
      fail("Decided rows must clear candidates");
  });
export type ReviewReceipt = z.infer<typeof reviewReceiptSchema>;

/** The activity row's primary key and namespace must bind the payload, not just its JSON. */
export function readReviewReceiptRecord(input: unknown): ReviewReceipt {
  const row = z
    .object({
      id: z.uuid(),
      entityType: z.enum(["ebook", "work"]),
      entityId: z.uuid(),
      eventKey: z.string(),
      metadata: z.object({
        extra: z.object({ ebookReview: reviewReceiptSchema }),
      }),
    })
    .parse(input);
  const receipt = row.metadata.extra.ebookReview;
  if (
    row.id !== receipt.operation.operationId ||
    row.entityType !== receipt.entityType ||
    row.entityId !== receipt.entityId ||
    row.eventKey !== receipt.eventKey
  )
    throw new Error("Activity row does not bind its review receipt");
  return receipt;
}

/** Called only after the writer locks the target. This pure check cannot prove a DB commit. */
export function verifyReviewRetry(
  stored: unknown,
  input: unknown,
): ReviewReceipt {
  const receipt = readReviewReceiptRecord(stored);
  const request: ReviewDecisionRequest =
    reviewDecisionRequestSchema.parse(input);
  const entityType = "ebookId" in request ? "ebook" : "work";
  const entityId = "ebookId" in request ? request.ebookId : request.workId;
  if (
    receipt.action === "undo" ||
    receipt.entityType !== entityType ||
    receipt.entityId !== entityId ||
    receipt.action !== request.action ||
    canonicalReviewJson(receipt.operation) !==
      canonicalReviewJson(request.operation) ||
    receipt.requestHash !== reviewRequestHash(request) ||
    receipt.effectHash !== request.effectHash
  )
    throw new Error("This operation key belongs to another request");
  if (receipt.entityType === "ebook" && "ebookId" in request) {
    if (
      receipt.before.updatedAt !== request.stamp.updatedAt ||
      receipt.before.matchFingerprint !== request.stamp.matchFingerprint ||
      (request.action === "exclude" &&
        receipt.after.exclusionReason !== request.reason) ||
      (request.action === "restore" &&
        receipt.before.matchState !== request.expectedState)
    )
      throw new Error("Receipt states do not bind the request");
  } else if (
    receipt.entityType === "work" &&
    request.action === "mark_accessioned" &&
    canonicalReviewJson(receipt.before) !== canonicalReviewJson(request.stamp)
  )
    throw new Error("Receipt work stamp does not bind the request");
  return receipt;
}

/** Stored compensation outcome is authoritative after response loss; never perform the inverse twice. */
export function verifyReviewUndoRetry(
  stored: unknown,
  originalReceipt: unknown,
): ReviewReceipt {
  const compensation = readReviewReceiptRecord(stored);
  const original = readReviewReceiptRecord(originalReceipt);
  if (
    original.action === "undo" ||
    compensation.action !== "undo" ||
    compensation.entityType !== original.entityType ||
    compensation.entityId !== original.entityId ||
    canonicalReviewJson(compensation.originalOperation) !==
      canonicalReviewJson(original.operation) ||
    compensation.requestHash !==
      reviewPayloadHash({
        action: "undo",
        entityType: original.entityType,
        entityId: original.entityId,
        originalOperation: original.operation,
      })
  )
    throw new Error("Compensation does not belong to this decision");
  if (
    canonicalReviewJson(compensation.before) !==
    canonicalReviewJson(original.after)
  )
    throw new Error(
      "Compensation did not guard the decision's exact after-state",
    );
  if (
    compensation.entityType === "work" &&
    original.entityType === "work" &&
    compensation.after.catalogueStatus !== original.before.catalogueStatus
  )
    throw new Error(
      "Compensation did not restore the previous catalogue status",
    );
  if (compensation.entityType === "ebook" && original.entityType === "ebook") {
    const pending = ["accept", "link", "accession", "keep", "exclude"].includes(
      original.action,
    );
    if (
      compensation.after.matchState !==
      (pending ? "pending" : original.before.matchState)
    )
      throw new Error("Compensation has the wrong resulting decision state");
  }
  return compensation;
}
