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
  // If Google Places coordinates were provided and no explicit placeId, create
  // a geographic places record and link it to this venue.
  let resolvedPlaceId = input.placeId ?? null;

  if (!resolvedPlaceId && input.placeCoordinates && input.formattedAddress) {
    try {
      const [geoPlace] = await db
        .insert(places)
        .values({
          name: input.name,
          fullName: input.formattedAddress,
          type: "venue",
          latitude: input.placeCoordinates.latitude,
          longitude: input.placeCoordinates.longitude,
        })
        .returning({ id: places.id });
      if (geoPlace) resolvedPlaceId = geoPlace.id;
    } catch {
      // Non-fatal: venue creation continues without a places link
    }
  }

  const [venue] = await db
    .insert(venues)
    .values({
      name: input.name,
      type: input.type,
      subtype: input.subtype ?? null,
      description: input.description ?? null,
      website: input.website ?? null,
      instagramHandle: input.instagramHandle ?? null,
      socialLinks: input.socialLinks ?? null,
      placeId: resolvedPlaceId,
      formattedAddress: input.formattedAddress ?? null,
      googlePlaceId: input.googlePlaceId ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      openingHours: input.openingHours ?? null,
      timezone: input.timezone ?? null,
      posterS3Key: input.posterS3Key ?? null,
      thumbnailS3Key: input.thumbnailS3Key ?? null,
      color: input.color ?? null,
      isFavorite: input.isFavorite ?? false,
      personalRating: input.personalRating ?? null,
      notes: input.notes ?? null,
      specialties: input.specialties ?? null,
      tags: input.tags ?? null,
      firstVisitDate: input.firstVisitDate ?? null,
      lastVisitDate: input.lastVisitDate ?? null,
    })
    .returning();

  // Generate slug after insert so we have the ID if needed
  const baseSlug = generateVenueSlug(venue.name);
  const existing = await db
    .select({ slug: venues.slug })
    .from(venues)
    .where(like(venues.slug, `${baseSlug}%`));
  const existingSlugs = existing
    .map((r) => r.slug)
    .filter((s): s is string => s !== null);
  const slug = makeUnique(baseSlug, existingSlugs);

  const [updated] = await db
    .update(venues)
    .set({ slug })
    .where(eq(venues.id, venue.id))
    .returning();

  return updated;
}

export async function updateVenue(id: string, input: Partial<CreateVenueInput>) {
  const updatePayload: Record<string, unknown> = {
    ...input,
    updatedAt: new Date(),
  };

  await db.update(venues).set(updatePayload).where(eq(venues.id, id));

  // Regenerate slug if name changed
  if (input.name !== undefined) {
    const current = await db.query.venues.findFirst({
      where: eq(venues.id, id),
      columns: { name: true, slug: true },
    });
    if (current) {
      const baseSlug = generateVenueSlug(current.name);
      const existing = await db
        .select({ slug: venues.slug })
        .from(venues)
        .where(like(venues.slug, `${baseSlug}%`));
      const existingSlugs = existing
        .map((r) => r.slug)
        .filter((s): s is string => s !== null && s !== current.slug);
      const slug = makeUnique(baseSlug, existingSlugs);
      await db.update(venues).set({ slug }).where(eq(venues.id, id));
    }
  }

  return { id };
}

export async function deleteVenue(id: string) {
  await db.delete(venues).where(eq(venues.id, id));
  return { id };
}
