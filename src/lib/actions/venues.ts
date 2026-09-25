"use server";

import { db } from "@/lib/db";
import { venues, places } from "@/lib/db/schema";
import {
  eq,
  and,
  asc,
  desc,
  ilike,
  like,
  inArray,
  count,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { slugify, makeUnique } from "@/lib/utils/slugify";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { createVenueSchema } from "@/lib/validations/venues";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VenueType =
  | "bookshop"
  | "online_store"
  | "cafe"
  | "library"
  | "museum"
  | "gallery"
  | "auction_house"
  | "market"
  | "fair"
  | "publisher"
  | "individual"
  | "other";

export interface CreateVenueInput {
  name: string;
  type: VenueType;
  subtype?: string | null;
  description?: string | null;
  website?: string | null;
  instagramHandle?: string | null;
  socialLinks?: Record<string, string> | null;
  placeId?: string | null;
  formattedAddress?: string | null;
  googlePlaceId?: string | null;
  /** Coordinates from Google Places — used to create a geographic places record */
  placeCoordinates?: { latitude: number; longitude: number } | null;
  phone?: string | null;
  email?: string | null;
  openingHours?: Record<string, unknown> | null;
  timezone?: string | null;
  posterS3Key?: string | null;
  thumbnailS3Key?: string | null;
  color?: string | null;
  isFavorite?: boolean;
  personalRating?: number | null;
  notes?: string | null;
  specialties?: string | null;
  tags?: string[] | null;
  firstVisitDate?: string | null;
  lastVisitDate?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateVenueSlug(name: string): string {
  const slug = slugify(name);
  return slug || "venue";
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getVenues(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
  sort?: "name" | "recent" | "rating";
  order?: "asc" | "desc";
  filters?: {
    types?: VenueType[];
    favorite?: boolean;
    tags?: string[];
  };
}) {
  const { search, limit = 48, offset = 0, sort = "name", order, filters } =
    opts ?? {};

  const conditions: SQL[] = [];

  if (search) {
    conditions.push(ilike(venues.name, `%${search}%`));
  }

  if (filters?.types?.length) {
    conditions.push(inArray(venues.type, filters.types));
  }

  if (filters?.favorite === true) {
    conditions.push(eq(venues.isFavorite, true));
  }

  if (filters?.tags?.length) {
    // PostgreSQL array overlap: tags && ARRAY[...tags]
    const tagArray = filters.tags.map((t) => sql`${t}`);
    conditions.push(
      sql`${venues.tags} && ARRAY[${sql.join(tagArray, sql`, `)}]::text[]`,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const dirFn =
    order === "asc" ? asc : order === "desc" ? desc : sort === "recent" ? desc : asc;

  const orderBy = (() => {
    switch (sort) {
      case "recent":
        return dirFn(venues.createdAt);
      case "rating":
        return dirFn(venues.personalRating);
      case "name":
      default:
        return dirFn(venues.name);
    }
  })();

  return db.query.venues.findMany({
    where,
    orderBy,
    limit,
    offset,
    with: {
      place: { columns: { id: true, name: true, fullName: true } },
    },
  });
}

export async function getVenueCount(opts?: {
  search?: string;
  filters?: {
    types?: VenueType[];
    favorite?: boolean;
    tags?: string[];
  };
}) {
  const { search, filters } = opts ?? {};
  const conditions: SQL[] = [];

  if (search) {
    conditions.push(ilike(venues.name, `%${search}%`));
  }
  if (filters?.types?.length) {
    conditions.push(inArray(venues.type, filters.types));
  }
  if (filters?.favorite === true) {
    conditions.push(eq(venues.isFavorite, true));
  }
  if (filters?.tags?.length) {
    const tagArray = filters.tags.map((t) => sql`${t}`);
    conditions.push(
      sql`${venues.tags} && ARRAY[${sql.join(tagArray, sql`, `)}]::text[]`,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [result] = await db
    .select({ count: count() })
    .from(venues)
    .where(where);
  return result.count;
}

export async function getVenue(id: string) {
  return db.query.venues.findFirst({
    where: eq(venues.id, id),
    with: {
      place: true,
    },
  });
}

export async function getVenueBySlug(slug: string) {
  return db.query.venues.findFirst({
    where: eq(venues.slug, slug),
    with: {
      place: true,
    },
  });
}

export async function getFavoriteVenues() {
  return db.query.venues.findMany({
    where: eq(venues.isFavorite, true),
    orderBy: asc(venues.name),
    with: {
      place: { columns: { id: true, name: true, fullName: true } },
    },
  });
}

export async function searchVenues(query: string) {
  return db.query.venues.findMany({
    where: ilike(venues.name, `%${query}%`),
    orderBy: asc(venues.name),
    limit: 20,
    with: {
      place: { columns: { id: true, name: true } },
    },
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createVenue(input: CreateVenueInput) {
  const validated = createVenueSchema.parse(input);
  // If Google Places coordinates were provided and no explicit placeId, create
  // a geographic places record and link it to this venue.
  let resolvedPlaceId = validated.placeId ?? null;

  if (!resolvedPlaceId && validated.placeCoordinates && validated.formattedAddress) {
    try {
      const [geoPlace] = await db
        .insert(places)
        .values({
          name: validated.name,
          fullName: validated.formattedAddress,
          type: "venue",
          latitude: validated.placeCoordinates.latitude,
          longitude: validated.placeCoordinates.longitude,
        })
        .returning({ id: places.id });
      if (geoPlace) resolvedPlaceId = geoPlace.id;
    } catch {
      // Non-fatal: venue creation continues without a places link
    }
  }

  // Generate the slug first, so the venue is inserted complete in one write
  const baseSlug = generateVenueSlug(validated.name);
  const existing = await db
    .select({ slug: venues.slug })
    .from(venues)
    .where(like(venues.slug, `${baseSlug}%`));
  const existingSlugs = existing
    .map((r) => r.slug)
    .filter((s): s is string => s !== null);
  const slug = makeUnique(baseSlug, existingSlugs);

  const [updated] = await db
    .insert(venues)
    .values({
      name: validated.name,
      slug,
      type: validated.type,
      subtype: validated.subtype ?? null,
      description: validated.description ?? null,
      website: validated.website ?? null,
      instagramHandle: validated.instagramHandle ?? null,
      socialLinks: validated.socialLinks ?? null,
      placeId: resolvedPlaceId,
      formattedAddress: validated.formattedAddress ?? null,
      googlePlaceId: validated.googlePlaceId ?? null,
      phone: validated.phone ?? null,
      email: validated.email ?? null,
      openingHours: validated.openingHours ?? null,
      timezone: validated.timezone ?? null,
      posterS3Key: validated.posterS3Key ?? null,
      thumbnailS3Key: validated.thumbnailS3Key ?? null,
      color: validated.color ?? null,
      isFavorite: validated.isFavorite ?? false,
      personalRating: validated.personalRating ?? null,
      notes: validated.notes ?? null,
      specialties: validated.specialties ?? null,
      tags: validated.tags ?? null,
      firstVisitDate: validated.firstVisitDate ?? null,
      lastVisitDate: validated.lastVisitDate ?? null,
    })
    .returning();

  invalidate(CACHE_TAGS.venues);
  return updated;
}

export async function updateVenue(id: string, input: Partial<CreateVenueInput>) {
  const updatePayload: Record<string, unknown> = {
    ...input,
    updatedAt: new Date(),
  };

  // Regenerate slug if name changed, in the same write as the name
  if (input.name !== undefined) {
    const current = await db.query.venues.findFirst({
      where: eq(venues.id, id),
      columns: { slug: true },
    });
    if (current) {
      const baseSlug = generateVenueSlug(input.name);
      const existing = await db
        .select({ slug: venues.slug })
        .from(venues)
        .where(like(venues.slug, `${baseSlug}%`));
      const existingSlugs = existing
        .map((r) => r.slug)
        .filter((s): s is string => s !== null && s !== current.slug);
      updatePayload.slug = makeUnique(baseSlug, existingSlugs);
    }
  }

  await db.update(venues).set(updatePayload).where(eq(venues.id, id));

  invalidate(CACHE_TAGS.venues);
  return { id };
}

export async function deleteVenue(id: string) {
  await db.delete(venues).where(eq(venues.id, id));
  invalidate(CACHE_TAGS.venues);
  return { id };
}
