import { icons } from "lucide-react";
import { z } from "zod/v4";

/** A Lucide icon name, as `setCollectionIcon` accepts it, or null to clear. */
const iconSchema = z
  .string()
  .max(64)
  .refine((name) => Object.hasOwn(icons, name), "Unknown icon")
  .nullable();

/** Edition IDs in the order they join the collection. */
export const editionIdsSchema = z.array(z.uuid()).min(1).max(1000);

/** POST /api/collections. Unknown fields are refused. */
export const createCollectionBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(5000).nullable().optional(),
    icon: iconSchema.optional(),
    editionIds: z.array(z.uuid()).max(1000).optional(),
    requestId: z.uuid().optional(),
  })
  .strict();

/** PATCH /api/collections/[id]. Unknown fields are refused. */
export const patchCollectionBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    icon: iconSchema.optional(),
  })
  .strict();

/** POST and DELETE /api/collections/[id]/editions. */
export const collectionEditionsBodySchema = z
  .object({ editionIds: editionIdsSchema })
  .strict();
