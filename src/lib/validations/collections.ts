import { z } from "zod";

export const collectionDetailsSchema = z
  .object({
    name: z.string().trim().min(1, "Collection name is required").max(160),
    description: z.string().trim().max(5000).nullable().optional(),
    sortOrder: z.number().int().min(0).max(1000000).optional(),
  })
  .strict();
export const collectionIdsSchema = z
  .array(z.string().uuid())
  .max(1000)
  .transform((ids) => [...new Set(ids)]);
export const collectionUpdateSchema = collectionDetailsSchema
  .partial()
  .extend({
    coverS3Key: z.string().max(1024).nullable().optional(),
    posterS3Key: z.string().max(1024).nullable().optional(),
    posterThumbnailS3Key: z.string().max(1024).nullable().optional(),
    backgroundS3Key: z.string().max(1024).nullable().optional(),
  })
  .strict();
