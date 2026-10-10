import { z } from "zod/v4";
import {
  ANNOTATION_BATCH_LIMIT,
  ANNOTATION_COLORS,
  ANNOTATION_TEXT_LIMIT,
  annotationCharacterCount,
} from "@/lib/reader/annotations";
import {
  annotationTimeMicros,
  canonicalAnnotationTime,
} from "@/lib/reader/sync/annotation-time";

const uuid = z.uuid().transform((id) => id.toLowerCase());
const unit = z.number().min(0).max(1);
function characters(limit: number) {
  return z
    .string()
    .refine(
      (text) => annotationCharacterCount(text) <= limit,
      `Select at most ${limit.toLocaleString("en")} characters`,
    )
    .refine(
      (text) =>
        !Array.from(text).some((c) => {
          const n = c.codePointAt(0)!;
          return n >= 0xd800 && n <= 0xdfff;
        }),
      "Text contains an incomplete Unicode character",
    )
    .refine(
      (text) => !text.includes("\u0000"),
      "Text contains a null character",
    );
}

/** Separate from position validation: an annotation carries the entire passage. */
export const annotationLocatorSchema = z.strictObject({
  v: z.literal(1),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  href: characters(2048),
  sectionIndex: z.number().int().min(0),
  progression: unit,
  totalProgression: unit,
  position: z.number().int().min(0).optional(),
  cfi: characters(4096).optional(),
  pdf: z
    .strictObject({
      page: z.number().int().min(1),
      rects: z
        .array(z.tuple([z.number(), z.number(), z.number(), z.number()]))
        .max(200)
        .optional(),
    })
    .optional(),
  text: z
    .strictObject({
      before: characters(64).optional(),
      highlight: characters(ANNOTATION_TEXT_LIMIT).optional(),
      after: characters(64).optional(),
    })
    .optional(),
  tocLabel: characters(300).optional(),
  pageLabel: characters(40).optional(),
});

export const deferredQuoteEffectSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("none") }),
  z.strictObject({
    action: z.enum(["keep-quote", "delete-quote"]),
    noteId: uuid,
    expectedNoteVersion: z.string().min(1),
    expectedBindingVersion: z.string().min(1),
  }),
]);

function timestamp(now?: number) {
  return z.string().transform((value, ctx) => {
    try {
      const canonical = canonicalAnnotationTime(value);
      if (
        now !== undefined &&
        annotationTimeMicros(canonical) >
          BigInt(Math.floor(now + 5 * 60 * 1000)) * BigInt(1000)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "clientUpdatedAt is in the future",
        });
        return z.NEVER;
      }
      return canonical;
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid annotation timestamp" });
      return z.NEVER;
    }
  });
}

export function annotationUpsertSchema(now = Date.now()) {
  const at = timestamp(now);
  const put = z
    .strictObject({
      op: z.literal("put"),
      id: uuid,
      fileId: uuid,
      kind: z.enum(["highlight", "bookmark"]),
      style: z.enum(["highlight", "underline"]),
      color: z.enum(ANNOTATION_COLORS).nullable(),
      locator: annotationLocatorSchema,
      text: characters(ANNOTATION_TEXT_LIMIT).nullable(),
      note: characters(ANNOTATION_TEXT_LIMIT).nullable(),
      chapter: characters(300).nullable(),
      clientUpdatedAt: at,
    })
    .superRefine((item, ctx) => {
      if (item.kind === "bookmark") {
        if (
          item.style !== "highlight" ||
          item.color !== null ||
          item.text !== null ||
          item.note !== null
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Bookmarks cannot carry highlight style, colour, text or note",
          });
      } else if (
        !item.color ||
        !item.text?.trim() ||
        !item.locator.text?.highlight?.trim()
      ) {
        ctx.addIssue({
          code: "custom",
          message: "A highlight needs a colour and its complete text quote",
        });
      }
    });
  return z.discriminatedUnion("op", [
    put,
    z.strictObject({
      op: z.literal("note"),
      id: uuid,
      note: characters(ANNOTATION_TEXT_LIMIT).nullable(),
      clientUpdatedAt: at,
    }),
    // Compare-and-set: healing cannot publish a newer user edit or overwrite a note.
    z.strictObject({
      op: z.literal("reanchor"),
      id: uuid,
      fileId: uuid,
      locator: annotationLocatorSchema,
      anchorState: z.enum(["exact", "healed", "approximate", "orphaned"]),
      expectedFileId: uuid,
      expectedClientUpdatedAt: at,
    }),
  ]);
}

export function annotationDeleteSchema(now = Date.now()) {
  return z.strictObject({
    id: uuid,
    clientUpdatedAt: timestamp(now),
    // Optional for existing plain deletes; quote deletes require a prepared
    // choice, checked against the actual annotation by the composed operation.
    quoteEffect: deferredQuoteEffectSchema.optional(),
  });
}

export function annotationDeleteRequestSchema(now = Date.now()) {
  return annotationDeleteSchema(now)
    .extend({
      operationId: z.string().min(1).optional(),
      revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .superRefine((item, ctx) => {
      if (
        (item.operationId === undefined) !== (item.revision === undefined) ||
        (item.quoteEffect?.action !== undefined &&
          item.quoteEffect.action !== "none" &&
          item.operationId === undefined)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "A composed delete needs its exact operation id and revision",
        });
    });
}

export function annotationBodySchema(now = Date.now()) {
  return z
    .strictObject({
      upserts: z.array(annotationUpsertSchema(now)).max(ANNOTATION_BATCH_LIMIT),
      deletes: z
        .array(annotationDeleteRequestSchema(now))
        .max(ANNOTATION_BATCH_LIMIT),
    })
    .superRefine((body, ctx) => {
      const items = [...body.upserts, ...body.deletes];
      if (items.length > ANNOTATION_BATCH_LIMIT)
        ctx.addIssue({
          code: "custom",
          message: "At most 200 changes per request",
        });
      if (new Set(items.map((item) => item.id)).size !== items.length)
        ctx.addIssue({
          code: "custom",
          message: "An annotation id may occur only once per request",
        });
    });
}

export type AnnotationUpsert = z.output<
  ReturnType<typeof annotationUpsertSchema>
>;
export type AnnotationDelete = z.output<
  ReturnType<typeof annotationDeleteSchema>
>;
export type AnnotationDeleteRequest = z.output<
  ReturnType<typeof annotationDeleteRequestSchema>
>;

/** Validate received rows too; quotes are accepted only from the server response. */
export const annotationRecordSchema = z
  .strictObject({
    id: uuid,
    ebookId: uuid,
    fileId: uuid,
    kind: z.enum(["highlight", "bookmark"]),
    style: z.enum(["highlight", "underline", "quote"]),
    color: z.enum(ANNOTATION_COLORS).nullable(),
    locator: annotationLocatorSchema,
    progression: unit,
    chapter: characters(300).nullable(),
    text: characters(ANNOTATION_TEXT_LIMIT).nullable(),
    note: characters(ANNOTATION_TEXT_LIMIT).nullable(),
    anchorState: z.enum(["exact", "healed", "approximate", "orphaned"]),
    deviceId: characters(100).nullable(),
    clientUpdatedAt: timestamp(),
    createdAt: timestamp(),
    updatedAt: timestamp(),
    deletedAt: timestamp().nullable(),
  })
  .superRefine((item, ctx) => {
    if (
      item.kind === "bookmark" &&
      (item.style !== "highlight" ||
        item.color !== null ||
        item.text !== null ||
        item.note !== null)
    )
      ctx.addIssue({ code: "custom", message: "Invalid bookmark annotation" });
    if (
      item.kind === "highlight" &&
      (!item.text?.trim() || (item.style !== "quote" && item.color === null))
    )
      ctx.addIssue({ code: "custom", message: "Invalid highlight annotation" });
    if (
      item.style === "quote" &&
      (item.kind !== "highlight" || item.color !== null || !item.text?.trim())
    )
      ctx.addIssue({ code: "custom", message: "Invalid quote annotation" });
  });

export const annotationPullSchema = z
  .strictObject({
    annotations: z.array(annotationRecordSchema),
    serverTime: timestamp(),
    reset: z.boolean(),
  })
  .superRefine((pull, ctx) => {
    if (
      new Set(pull.annotations.map((item) => item.id)).size !==
      pull.annotations.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate annotation in response",
      });
    if (
      pull.annotations.some(
        (item) =>
          annotationTimeMicros(item.updatedAt) >
          annotationTimeMicros(pull.serverTime),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Annotation exceeds response cursor",
      });
  });
