import { z } from "zod/v4";
import { VENUE_TYPES } from "@/lib/catalogue/venues";
import { sourceUrlSchema } from "@/lib/catalogue/provenance";

const shortText = z.string().trim().max(500).nullable().optional();
const longText = z.string().max(50000).nullable().optional();
const date = z.iso.date().nullable().optional();
const venueFields = z.strictObject({
  name: z.string().trim().min(1).max(500),
  type: z.enum(VENUE_TYPES),
  subtype: shortText,
  description: longText,
  website: sourceUrlSchema.nullable().optional(),
  instagramHandle: z.string().trim().max(100).nullable().optional(),
  socialLinks: z.record(z.string().max(50), sourceUrlSchema).nullable().optional(),
  placeId: z.uuid().nullable().optional(),
  formattedAddress: z.string().trim().max(2000).nullable().optional(),
  googlePlaceId: shortText,
  placeCoordinates: z.strictObject({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).nullable().optional(),
  phone: z.string().trim().max(100).nullable().optional(),
  email: z.email().max(320).nullable().optional(),
  openingHours: z.record(z.string(), z.json()).nullable().optional(),
  timezone: z.string().max(100).refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
    catch { return false; }
  }, "Invalid timezone").nullable().optional(),
  posterS3Key: shortText,
  thumbnailS3Key: shortText,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  isFavorite: z.boolean().optional(),
  personalRating: z.number().int().min(1).max(5).nullable().optional(),
  notes: longText,
  specialties: longText,
  tags: z.array(z.string().trim().min(1).max(100)).max(100).nullable().optional(),
  firstVisitDate: date,
  lastVisitDate: date,
});
function validDates(v: { firstVisitDate?: string | null; lastVisitDate?: string | null }) {
  return !v.firstVisitDate || !v.lastVisitDate || v.firstVisitDate <= v.lastVisitDate;
}
export const createVenueSchema = venueFields.refine(validDates, "Last visit cannot precede first visit");
export const updateVenueSchema = venueFields.partial().refine(validDates, "Last visit cannot precede first visit");
export type CreateVenueInput = z.input<typeof createVenueSchema>;
export const venueSearchSchema = z.strictObject({
  search: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(200).default(48),
  offset: z.number().int().min(0).max(2147483647).default(0),
  sort: z.enum(["name", "recent", "rating"]).default("name"),
  order: z.enum(["asc", "desc"]).optional(),
  filters: z.strictObject({
    types: z.array(z.enum(VENUE_TYPES)).max(VENUE_TYPES.length).optional(),
    favorite: z.boolean().optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    archived: z.enum(["exclude", "include", "only"]).default("exclude"),
    organizationId: z.uuid().optional(),
  }).optional(),
});
