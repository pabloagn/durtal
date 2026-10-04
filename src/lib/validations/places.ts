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

/** A geocoding result from /api/geocode, to store as a place */
export const geocodedPlaceSchema = z.object({
  city: z.string().max(500).nullable(),
  region: z.string().max(500).nullable(),
  country: z.string().max(500).nullable(),
  countryCode: z.string().length(2).nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  displayName: z.string().max(1000),
});

export type CreatePlaceInput = z.infer<typeof createPlaceSchema>;
export type GeocodedPlaceInput = z.input<typeof geocodedPlaceSchema>;
