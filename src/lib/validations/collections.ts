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
// Artwork is managed through `media` (collection owner), not collection fields.
export const collectionUpdateSchema = collectionDetailsSchema.partial().strict();
