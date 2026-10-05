import { z } from "zod/v4";
import { bookLinksSchema } from "./book-links";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import { RATING_SCHEMA } from "./helpers";

export const createWorkSchema = z.object({
  // This is the legacy book entry point. Do not silently strip another kind.
  kind: z.literal("book").default("book"),
  title: z.string().min(1, "Title is required").max(500),
  originalLanguage: z.string().default("en"),
  originalYear: z.number().int().min(-3000).max(2100).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  seriesName: z.string().max(300).nullable().optional(),
  seriesPosition: z.string().max(20).nullable().optional(),
  isAnthology: z.boolean().default(false),
  workTypeId: z.string().uuid().nullable().optional(),
  seriesId: z.string().uuid().nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  rating: RATING_SCHEMA,
  recommenderIds: z.array(z.string().uuid()).optional(),
  catalogueStatus: z
    .enum([
      "tracked",
      "shortlisted",
      "wanted",
      "on_order",
      "accessioned",
      "deaccessioned",
    ])
    .default("tracked"),
  acquisitionPriority: z
    .enum(["none", "low", "medium", "high", "urgent"])
    .default("none"),
  authorIds: z
    .array(
      z.object({
        authorId: z.string().uuid(),
        role: z.enum(WORK_DOMAINS.book.creatorRoles).default("author"),
      }),
    )
    .min(1, "At least one author is required"),
  subjectIds: z.array(z.string().uuid()).optional(),
  metadataSource: z.string().max(100).nullable().optional(),
  metadataSourceId: z.string().max(200).nullable().optional(),
  goodreadsUrl: bookLinksSchema.shape.goodreadsUrl,
  storygraphUrl: bookLinksSchema.shape.storygraphUrl,
});

export const updateWorkSchema = createWorkSchema.partial().extend({
  // Kind is identity, not editable metadata (even when the value is unchanged).
  kind: z.never().optional(),
  // Zod 4 evaluates defaults inside optional fields. A partial edit must not
  // reset language, lifecycle or anthology metadata to creation defaults.
  originalLanguage: createWorkSchema.shape.originalLanguage
    .removeDefault()
    .optional(),
  isAnthology: createWorkSchema.shape.isAnthology.removeDefault().optional(),
  catalogueStatus: createWorkSchema.shape.catalogueStatus
    .removeDefault()
    .optional(),
  acquisitionPriority: createWorkSchema.shape.acquisitionPriority
    .removeDefault()
    .optional(),
  authorIds: z
    .array(
      z.object({
        authorId: z.string().uuid(),
        role: z.enum(WORK_DOMAINS.book.creatorRoles).default("author"),
      }),
    )
    .optional(),
})
  // Unknown keys are rejected: an update cannot set a column the form does
  // not expose (slug, createdAt, ...), and a typo is not silently ignored.
  .strict();

export type CreateWorkInput = z.input<typeof createWorkSchema>;
export type UpdateWorkInput = z.input<typeof updateWorkSchema>;
