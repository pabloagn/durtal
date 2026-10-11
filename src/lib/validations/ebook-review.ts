import { z } from "zod/v4";
import { normalizeLanguage } from "@/lib/utils/language";
import { validIsbn } from "@/lib/harmonization/normalize";
import { newCopyDraftSchema, existingCopyPatchSchema, existingCopyStampSchema } from "@/lib/ebooks/match/manual-intents";

const uuid = z.uuid().transform((value) => value.toLowerCase());
export const reviewHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
/** Canonical database serialization, including microseconds. Never convert a guard to Date. */
export const reviewTimestampSchema = z.iso.datetime().regex(/\.\d{6}Z$/);
export const exclusionReasonSchema = z.enum([
  "duplicate",
  "not_a_book",
  "other",
]);
export const reviewOperationSchema = z.strictObject({
  version: z.literal(1),
  operationId: uuid,
  runId: uuid,
  planSha256: reviewHashSchema,
  /** Opaque server-resolved database identity, not a client-supplied connection URL. */
  targetDatabase: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[a-zA-Z0-9._:/-]+$/),
});
export const ebookReviewStampSchema = z.strictObject({
  matchFingerprint: reviewHashSchema.nullable(),
  updatedAt: reviewTimestampSchema,
});
export const workReviewStampSchema = z.strictObject({
  updatedAt: reviewTimestampSchema,
  catalogueStatus: z.enum([
    "tracked",
    "shortlisted",
    "wanted",
    "on_order",
    "accessioned",
    "deaccessioned",
  ]),
  historyFingerprint: reviewHashSchema,
  dependencyFingerprint: reviewHashSchema,
  latestHistoryId: uuid.nullable(),
});
const decision = {
  ebookId: uuid,
  stamp: ebookReviewStampSchema,
  operation: reviewOperationSchema,
  effectHash: reviewHashSchema,
};
export const acceptEbookCandidateSchema = z.strictObject({
  ...decision,
  rank: z.number().int().min(1).max(3),
  candidateHash: reviewHashSchema,
});
const language = z
  .string()
  .min(1)
  .max(100)
  .transform((value, context) => {
    const normalized = normalizeLanguage(value);
    if (!normalized) {
      context.addIssue({ code: "custom", message: "Choose a known language" });
      return z.NEVER;
    }
    return normalized;
  });
const isbn13 = z
  .string()
  .regex(/^97[89]\d{10}$/)
  .refine((value) => validIsbn(value, 13), "Choose a valid ISBN-13");
/** Intent only. The matching planner selects and verifies the executable edition rule. */
export const ebookEditionChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fill_copy"),
    editionId: uuid,
    instanceId: uuid,
  }),
  z.strictObject({ kind: z.literal("add_copy"), editionId: uuid }),
  z.strictObject({
    kind: z.literal("new_edition"),
    language: language.optional(),
    isbn13: isbn13.nullable().optional(),
  }),
]);
const linkEbookToWorkFields = z.strictObject({
  ...decision,
  workId: uuid,
  choice: ebookEditionChoiceSchema,
  locationId: uuid.optional(),
  newCopyDraft: newCopyDraftSchema.optional(),
  existingCopyPatch: existingCopyPatchSchema.optional(),
  expectedCopyStamp: existingCopyStampSchema.optional(),
});
function requireExistingCopyIntent(value: z.output<typeof linkEbookToWorkFields> | Omit<z.output<typeof linkEbookToWorkFields>, "stamp" | "operation" | "effectHash">, context: z.RefinementCtx) {
  const patch = value.existingCopyPatch !== undefined, stamp = value.expectedCopyStamp !== undefined;
  if (patch !== stamp) context.addIssue({ code: "custom", path: [patch ? "expectedCopyStamp" : "existingCopyPatch"],
    message: "An existing copy edit requires its complete copy stamp and patch." });
  if ((patch || stamp) && (value.choice.kind !== "fill_copy" || value.newCopyDraft !== undefined))
    context.addIssue({ code: "custom", path: ["existingCopyPatch"],
      message: "Metadata edits require the selected existing copy." });
}
export const linkEbookToWorkSchema = linkEbookToWorkFields.superRefine(requireExistingCopyIntent);
export const reviewAuthorChoiceSchema = z.union([
  z.strictObject({ id: uuid }),
  z.strictObject({ name: z.string().trim().min(1).max(300) }),
]);
export const accessionEbookSchema = z.strictObject({
  ...decision,
  authors: z.array(reviewAuthorChoiceSchema).min(1).max(50).optional(),
  language: language.optional(),
  isbn13: isbn13.nullable().optional(),
});
export const keepEbookStandaloneSchema = z.strictObject(decision);
export const excludeEbookSchema = z.strictObject({
  ...decision,
  reason: exclusionReasonSchema,
});
export const rematchEbookSchema = z.strictObject(decision);
export const restoreEbookToReviewSchema = z.strictObject({
  ...decision,
  expectedState: z.enum(["standalone", "excluded"]),
});
export const undoEbookDecisionSchema = z.strictObject({
  ebookId: uuid,
  originalOperation: reviewOperationSchema,
});
export const unlinkEbookSchema = z.strictObject({
  ...decision,
  originalOperation: reviewOperationSchema,
});
export const markWorkAccessionedSchema = z
  .strictObject({
    workId: uuid,
    stamp: workReviewStampSchema,
    operation: reviewOperationSchema,
    effectHash: reviewHashSchema,
  })
  .refine(
    (value) =>
      ["tracked", "shortlisted", "wanted", "on_order"].includes(
        value.stamp.catalogueStatus,
      ),
    "This book is not partially held",
  );
export const undoWorkAccessionedSchema = z.strictObject({
  workId: uuid,
  originalOperation: reviewOperationSchema,
});
export const prepareWorkReviewSchema = z.strictObject({ action: z.literal("mark_accessioned"), workId: uuid });
export const confirmedWorkReviewSchema = z.strictObject({
  request: markWorkAccessionedSchema.safeExtend({ action: z.literal("mark_accessioned") }),
  previewToken: z.string().regex(/^[0-9a-f]{64}$/),
});

export const reviewDecisionRequestSchema = z.discriminatedUnion("action", [
  acceptEbookCandidateSchema.extend({ action: z.literal("accept") }),
  linkEbookToWorkSchema.safeExtend({ action: z.literal("link") }),
  accessionEbookSchema.extend({ action: z.literal("accession") }),
  keepEbookStandaloneSchema.extend({ action: z.literal("keep") }),
  excludeEbookSchema.extend({ action: z.literal("exclude") }),
  rematchEbookSchema.extend({ action: z.literal("rematch") }),
  restoreEbookToReviewSchema.extend({ action: z.literal("restore") }),
  unlinkEbookSchema.extend({ action: z.literal("unlink") }),
  // Keep refinement on the object: extend() cannot extend an object with refinements.
  markWorkAccessionedSchema.safeExtend({
    action: z.literal("mark_accessioned"),
  }),
]);
export type ReviewDecisionRequest = z.infer<typeof reviewDecisionRequestSchema>;
export type ReviewOperation = z.infer<typeof reviewOperationSchema>;

/** Preparation contains intent only; operation, stamp and effect are issued by
 * the server. Work changes and fresh unlink are intentionally not supported. */
export const prepareEbookReviewSchema = z.discriminatedUnion("action", [
  acceptEbookCandidateSchema.omit({ stamp: true, operation: true, effectHash: true })
    .extend({ action: z.literal("accept") }),
  linkEbookToWorkFields.omit({ stamp: true, operation: true, effectHash: true })
    .extend({ action: z.literal("link") }).superRefine(requireExistingCopyIntent),
  accessionEbookSchema.omit({ stamp: true, operation: true, effectHash: true })
    .extend({ action: z.literal("accession") }),
  keepEbookStandaloneSchema.omit({ stamp: true, operation: true, effectHash: true })
    .extend({ action: z.literal("keep") }),
  excludeEbookSchema.omit({ stamp: true, operation: true, effectHash: true })
    .extend({ action: z.literal("exclude") }),
  rematchEbookSchema.omit({ stamp: true, operation: true, effectHash: true })
    .extend({ action: z.literal("rematch") }),
  restoreEbookToReviewSchema.omit({ stamp: true, operation: true, effectHash: true })
    .extend({ action: z.literal("restore") }),
]);
export type PrepareEbookReview = z.output<typeof prepareEbookReviewSchema>;
export const confirmedEbookReviewSchema = z.strictObject({
  request: reviewDecisionRequestSchema,
  previewToken: z.string().regex(/^[0-9a-f]{64}$/),
});

export const reviewChunkSchema = z
  .array(reviewDecisionRequestSchema)
  .min(1)
  .max(50)
  .superRefine((rows, context) => {
    const operations = new Set<string>();
    const entities = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const entity =
        "ebookId" in row ? `ebook:${row.ebookId}` : `work:${row.workId}`;
      if (operations.has(row.operation.operationId) || entities.has(entity))
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Each operation and target appears once per chunk",
        });
      operations.add(row.operation.operationId);
      entities.add(entity);
      if (
        row.operation.runId !== rows[0].operation.runId ||
        row.operation.targetDatabase !== rows[0].operation.targetDatabase
      )
        context.addIssue({
          code: "custom",
          path: [index],
          message: "A chunk belongs to one run and database",
        });
    }
  });

/** A bounded ordered selection. Only the returned prepared prefix is confirmed;
 * deferred intents require a fresh visible preview after that prefix commits. */
export const prepareReviewSelectionSchema = z.strictObject({
  intents: z.array(prepareEbookReviewSchema).min(1).max(50),
}).superRefine(({ intents }, context) => {
  if (new Set(intents.map((row) => row.ebookId)).size !== intents.length)
    context.addIssue({ code: "custom", path: ["intents"], message: "Each selected eBook appears once" });
});
export const confirmedReviewSelectionSchema = z.strictObject({
  requests: reviewChunkSchema,
  previewToken: z.string().regex(/^[0-9a-f]{64}$/),
});
export const undoReviewSelectionSchema = z.strictObject({
  requests: z.array(undoEbookDecisionSchema).min(1).max(50),
}).superRefine(({ requests }, context) => {
  if (new Set(requests.map((row) => row.ebookId)).size !== requests.length ||
      new Set(requests.map((row) => row.originalOperation.operationId)).size !== requests.length)
    context.addIssue({ code: "custom", path: ["requests"], message: "Each original operation and eBook appears once" });
});
