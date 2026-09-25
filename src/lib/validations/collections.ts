import { z } from "zod/v4";
import { toUpdateSchema } from "./helpers";

/** Media keys written by the upload pipeline (gold/media/collection/...). */
const s3Key = z.string().max(500).regex(/^gold\//, "Invalid storage key").nullable();

export const createCollectionSchema = z.object({
  name: z.string().min(1, "Name is required").max(300),
  description: z.string().max(5000).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

/** Partial update: no defaults, unknown keys rejected. Image keys come from the media routes. */
export const updateCollectionSchema = toUpdateSchema(
  createCollectionSchema.extend({
    coverS3Key: s3Key,
    posterS3Key: s3Key,
    posterThumbnailS3Key: s3Key,
    backgroundS3Key: s3Key,
  }),
);

export type CreateCollectionInput = z.input<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.input<typeof updateCollectionSchema>;
