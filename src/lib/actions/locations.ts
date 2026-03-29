"use server";

import { db } from "@/lib/db";
import { locations, subLocations } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";

export const getLocations = cached(
  () =>
    db.query.locations.findMany({
      orderBy: asc(locations.sortOrder),
      with: {
        subLocations: {
          orderBy: asc(subLocations.sortOrder),
        },
        instances: {
          columns: { id: true },
        },
      },
    }),
  ["locations"],
  [CACHE_TAGS.locations],
);

export async function getLocation(id: string) {
  return db.query.locations.findFirst({
    where: eq(locations.id, id),
    with: {
      subLocations: {
        orderBy: asc(subLocations.sortOrder),
      },
    },
  });
}

export async function createLocation(input: {
  name: string;
  type: string;
  street?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryCode?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  icon?: string | null;
  color?: string | null;
  sortOrder?: number;
}) {
  const [location] = await db.insert(locations).values(input).returning();
  invalidate(CACHE_TAGS.locations);
  return location;
}

export async function updateLocation(
  id: string,
  input: Partial<{
    name: string;
    type: string;
    street: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    countryCode: string | null;
    postalCode: string | null;
    latitude: number | null;
    longitude: number | null;
    icon: string | null;
    color: string | null;
    sortOrder: number;
    isActive: boolean;
  }>,
) {
  await db.update(locations).set(input).where(eq(locations.id, id));
  invalidate(CACHE_TAGS.locations);
  return { id };
}

export async function deleteLocation(id: string) {
  await db.delete(locations).where(eq(locations.id, id));
  invalidate(CACHE_TAGS.locations);
  return { id };
}

export async function createSubLocation(input: {
  locationId: string;
  name: string;
  sortOrder?: number;
}) {
  const [sub] = await db.insert(subLocations).values(input).returning();
  return sub;
}

export async function updateSubLocation(
  id: string,
  input: Partial<{ name: string; sortOrder: number }>,
) {
  await db.update(subLocations).set(input).where(eq(subLocations.id, id));
  return { id };
}

export async function deleteSubLocation(id: string) {
  await db.delete(subLocations).where(eq(subLocations.id, id));
  return { id };
}
