import { z } from "zod/v4";
import { toUpdateSchema } from "./helpers";

export const createVenueSchema = z.object({
  name: z.string().min(1).max(500),
  type: z.enum(["bookshop", "online_store", "cafe", "library", "museum", "gallery", "auction_house", "market", "fair", "publisher", "individual", "other"]),
  subtype: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  instagramHandle: z.string().nullable().optional(),
  socialLinks: z.record(z.string(), z.string()).nullable().optional(),
  placeId: z.string().uuid().nullable().optional(),
  formattedAddress: z.string().nullable().optional(),
  googlePlaceId: z.string().nullable().optional(),
  placeCoordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  openingHours: z.record(z.string(), z.unknown()).nullable().optional(),
  timezone: z.string().nullable().optional(),
  posterS3Key: z.string().nullable().optional(),
  thumbnailS3Key: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  isFavorite: z.boolean().optional(),
  personalRating: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().nullable().optional(),
  specialties: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  firstVisitDate: z.string().nullable().optional(),
  lastVisitDate: z.string().nullable().optional(),
});

/** Partial update: no defaults, unknown keys rejected. */
export const updateVenueSchema = toUpdateSchema(createVenueSchema);

export type CreateVenueInput = z.infer<typeof createVenueSchema>;
export type UpdateVenueInput = z.input<typeof updateVenueSchema>;
