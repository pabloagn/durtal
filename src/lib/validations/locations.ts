import { z } from "zod/v4";
import { toUpdateSchema } from "./helpers";

export const createLocationSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["physical", "digital"]),
  street: z.string().max(500).nullable().optional(),
  city: z.string().max(200).nullable().optional(),
  region: z.string().max(200).nullable().optional(),
  country: z.string().max(200).nullable().optional(),
  countryCode: z.string().max(2).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  color: z.string().max(7).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

/** Partial update: no defaults, unknown keys rejected. Locations can also be deactivated. */
export const updateLocationSchema = toUpdateSchema(createLocationSchema.extend({ isActive: z.boolean() }));

export const createSubLocationSchema = z.object({
  locationId: z.string().uuid(),
  name: z.string().min(1).max(200),
  sortOrder: z.number().int().optional(),
});

/** A sub-location cannot move to another location. */
export const updateSubLocationSchema = toUpdateSchema(createSubLocationSchema.omit({ locationId: true }));

export type CreateLocationInput = z.input<typeof createLocationSchema>;
export type UpdateLocationInput = z.input<typeof updateLocationSchema>;
export type CreateSubLocationInput = z.input<typeof createSubLocationSchema>;
export type UpdateSubLocationInput = z.input<typeof updateSubLocationSchema>;
