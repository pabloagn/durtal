"use server";

import { db } from "@/lib/db";
import { locations, subLocations } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";
import {
  createLocationSchema,
  updateLocationSchema,
  createSubLocationSchema,
  updateSubLocationSchema,
  type CreateLocationInput,
  type UpdateLocationInput,
  type CreateSubLocationInput,
  type UpdateSubLocationInput,
} from "@/lib/validations/locations";
import { parseId } from "@/lib/validations/helpers";

export const getLocations = cached(
  () =>
    db.query.locations.findMany({
      // Locations with the same sort order by name, so every list shows one order
      orderBy: [asc(locations.sortOrder), asc(locations.name)],
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

export async function createLocation(input: CreateLocationInput) {
  const [location] = await db
    .insert(locations)
    .values(createLocationSchema.parse(input))
    .returning();
  invalidate(CACHE_TAGS.locations);
  return location;
}

export async function updateLocation(id: string, input: UpdateLocationInput) {
  parseId(id);
  await db
    .update(locations)
    .set(updateLocationSchema.parse(input))
    .where(eq(locations.id, id));
  invalidate(CACHE_TAGS.locations);
  return { id };
}

export async function deleteLocation(id: string) {
  await db.delete(locations).where(eq(locations.id, id));
  // The database clears the default location when it is this one
  invalidate(CACHE_TAGS.locations, CACHE_TAGS.settings);
  return { id };
}

export async function createSubLocation(input: CreateSubLocationInput) {
  const [sub] = await db
    .insert(subLocations)
    .values(createSubLocationSchema.parse(input))
    .returning();
  invalidate(CACHE_TAGS.locations);
  return sub;
}

export async function updateSubLocation(
  id: string,
  input: UpdateSubLocationInput,
) {
  parseId(id);
  await db
    .update(subLocations)
    .set(updateSubLocationSchema.parse(input))
    .where(eq(subLocations.id, id));
  invalidate(CACHE_TAGS.locations);
  return { id };
}

export async function deleteSubLocation(id: string) {
  await db.delete(subLocations).where(eq(subLocations.id, id));
  invalidate(CACHE_TAGS.locations);
  return { id };
}
