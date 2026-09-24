import { z } from "zod/v4";

export const createPlaceSchema = z.object({
  name: z.string().min(1).max(500),
  fullName: z.string().max(1000).nullable().optional(),
  type: z.string().min(1).max(100),
  parentId: z.string().uuid().nullable().optional(),
  countryId: z.string().uuid().nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  geonameId: z.number().int().nullable().optional(),
  wikidataId: z.string().nullable().optional(),
});

export type CreatePlaceInput = z.infer<typeof createPlaceSchema>;
